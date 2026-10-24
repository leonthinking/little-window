import { LAUNCHER_SIZE, BROWSER_SIZE, resolveInput, screenBounds } from "./core.js";
import { cleanHistory, addHistory, removeHistory } from "./history.js";
import { normalBounds, restoredBounds } from "./geometry.js";

const SEARCH_PAGE = chrome.runtime.getURL("search.html");
const SETUP_PAGE = chrome.runtime.getURL("setup.html");
const LANGUAGES = new Set(["auto", "en", "zh_CN"]);
const ERROR_CODES = new Set(["error_input", "error_empty", "error_too_long", "error_scheme", "error_url", "error_credentials", "error_stale", "error_operation", "error_open", "error_generic", "error_language"]);
const roleCache = new Map();
const updating = new Set();
let queue = Promise.resolve();

// Serialize all state mutations so fast submissions, launch requests and window
// events cannot lose history entries or overwrite another window's ownership.
function serialized(task) {
  const next = queue.then(task);
  queue = next.catch(() => {});
  return next;
}

async function session() {
  const state = await chrome.storage.session.get(["launcher", "trackedWindows"]);
  return { launcher: state.launcher, trackedWindows: state.trackedWindows || {} };
}

async function track(windowId, value) {
  const state = await session();
  state.trackedWindows[windowId] = value;
  roleCache.set(windowId, value);
  await chrome.storage.session.set({ trackedWindows: state.trackedWindows });
}

async function clearLauncher(windowId) {
  if (windowId === undefined || (await session()).launcher?.windowId === windowId) {
    await chrome.storage.session.remove("launcher");
  }
}

async function saveBounds(win, role) {
  const bounds = normalBounds(win);
  if (bounds && ["launcher", "browser"].includes(role)) {
    await chrome.storage.local.set({ [`${role}Bounds`]: bounds });
  }
}

async function updateBounds(windowId, geometry) {
  updating.add(windowId);
  try { return await chrome.windows.update(windowId, { state: "normal", ...geometry }); }
  finally { updating.delete(windowId); }
}

async function openLauncher() {
  const existing = (await session()).launcher;
  if (existing) {
    try {
      const tab = await chrome.tabs.get(existing.tabId);
      const win = await chrome.windows.get(existing.windowId);
      if (tab.windowId === win.id && tab.url === SEARCH_PAGE && !win.incognito && win.type === "popup") {
        await chrome.windows.update(existing.windowId, { state: "normal", focused: true });
        // The page filters by window ID so older restored launchers ignore this.
        await chrome.runtime.sendMessage({ type: "focus-input", windowId: existing.windowId }).catch(() => {});
        return;
      }
    } catch { /* Closed or navigated away; create a fresh launcher. */ }
    await clearLauncher();
  }
  const saved = (await chrome.storage.local.get("launcherBounds")).launcherBounds;
  let area;
  if (!screenBounds(saved)) {
    try { area = screenBounds(await chrome.windows.getLastFocused({ windowTypes: ["normal"] })); }
    catch { /* Chrome can have no normal windows. The page reports its screen. */ }
  }
  const geometry = restoredBounds(saved, area, LAUNCHER_SIZE, 0.32);
  const options = { type: "popup", url: SEARCH_PAGE, focused: true, incognito: false };
  let win;
  try {
    win = await chrome.windows.create({ ...options, ...geometry });
  } catch {
    // A disconnected display or an OS size limit can make formerly valid saved
    // bounds unacceptable before the page exists to report its current screen.
    // Let Chrome choose a visible position, then launcher-ready fits the saved
    // bounds to that screen. Never let stale geometry prevent opening entirely.
    try { win = await chrome.windows.create({ ...options, ...LAUNCHER_SIZE }); }
    catch { throw new Error("error_open"); }
  }
  const tabId = win?.tabs?.[0]?.id;
  if (!Number.isInteger(win?.id) || !Number.isInteger(tabId)) throw new Error("error_open");
  await track(win.id, { tabId, role: "launcher", ready: false });
  await chrome.storage.session.set({ launcher: { windowId: win.id, tabId } });
}

function isPage(sender, url) {
  return sender.id === chrome.runtime.id && sender.url === url && !sender.tab?.incognito;
}

async function fromLauncher(sender) {
  if (!isPage(sender, SEARCH_PAGE) || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.tab?.windowId)) {
    throw new Error("error_stale");
  }
  let tab, win;
  try {
    tab = await chrome.tabs.get(sender.tab.id);
    win = await chrome.windows.get(sender.tab.windowId);
  } catch { throw new Error("error_stale"); }
  if (tab.windowId !== win.id || tab.url !== SEARCH_PAGE ||
      (tab.pendingUrl && tab.pendingUrl !== SEARCH_PAGE) || win.type !== "popup" || win.incognito) {
    throw new Error("error_stale");
  }
  const state = await session();
  const known = state.trackedWindows[win.id];
  // Back navigation/session restore may bring back a previous search page.
  // Its page identity and live popup ownership must both be checked first.
  if (!known || known.tabId !== tab.id || known.role !== "launcher") {
    if (known?.role === "browser") await saveBounds(win, "browser");
    await track(win.id, { tabId: tab.id, role: "launcher", ready: false });
  } else {
    roleCache.set(win.id, known);
  }
  const current = { tabId: tab.id, windowId: win.id };
  if (!state.launcher) await chrome.storage.session.set({ launcher: current });
  return { ...current, win };
}

async function authorizePage(sender) {
  if (isPage(sender, SETUP_PAGE)) return;
  await fromLauncher(sender);
}

async function publicState() {
  const data = await chrome.storage.local.get(["history", "language"]);
  return { history: cleanHistory(data.history), language: LANGUAGES.has(data.language) ? data.language : "auto" };
}

async function dispatch(message, sender) {
  if (!message || typeof message.type !== "string") throw new Error("error_operation");
  if (["get-state", "history-remove", "history-clear", "set-language"].includes(message.type)) {
    await authorizePage(sender);
    if (message.type === "history-remove") {
      if (typeof message.id !== "string" || message.id.length > 100) throw new Error("error_operation");
      const { history } = await chrome.storage.local.get("history");
      await chrome.storage.local.set({ history: removeHistory(history, message.id) });
    } else if (message.type === "history-clear") {
      await chrome.storage.local.set({ history: [] });
    } else if (message.type === "set-language") {
      if (!LANGUAGES.has(message.language)) throw new Error("error_language");
      await chrome.storage.local.set({ language: message.language });
    }
    return publicState();
  }
  if (message.type === "open-launcher" && isPage(sender, SETUP_PAGE)) return openLauncher();
  const current = await fromLauncher(sender);
  if (message.type === "close-launcher") {
    await saveBounds(current.win, "launcher");
    await chrome.windows.remove(current.windowId);
    await clearLauncher(current.windowId);
    return;
  }
  if (message.type === "launcher-ready") {
    const area = screenBounds(message.screen);
    const state = await session();
    const tracked = state.trackedWindows[current.windowId];
    const saved = (await chrome.storage.local.get("launcherBounds")).launcherBounds;
    const base = tracked?.ready ? normalBounds(current.win) : saved;
    const geometry = restoredBounds(base, area, LAUNCHER_SIZE, 0.32);
    const win = await updateBounds(current.windowId, geometry);
    await track(current.windowId, { tabId: current.tabId, role: "launcher", ready: true });
    await saveBounds(win, "launcher");
    return publicState();
  }
  if (message.type === "browse") {
    const target = resolveInput(message.input);
    const area = screenBounds(message.screen);
    const before = normalBounds(current.win);
    await saveBounds(current.win, "launcher");
    const saved = (await chrome.storage.local.get("browserBounds")).browserBounds;
    const geometry = restoredBounds(saved, area, BROWSER_SIZE);
    // Switch the role before resizing; generated bounds events must never write
    // the browsing size back into the launcher preference.
    await track(current.windowId, { tabId: current.tabId, role: "browser" });
    try {
      const win = await updateBounds(current.windowId, { ...geometry, focused: true });
      await saveBounds(win, "browser");
      if (target.kind === "url") await chrome.tabs.update(current.tabId, { url: target.url });
      else await chrome.search.query({ text: target.text, tabId: current.tabId });
    } catch (error) {
      await track(current.windowId, { tabId: current.tabId, role: "launcher", ready: true });
      await updateBounds(current.windowId, before || restoredBounds(null, area, LAUNCHER_SIZE, 0.32)).catch(() => {});
      throw error;
    }
    // Only accepted submissions enter history. A page failing to load after a
    // successful navigation request still counts as a submitted lookup.
    const { history } = await chrome.storage.local.get("history");
    await chrome.storage.local.set({ history: addHistory(history, message.input) });
    await clearLauncher(current.windowId);
    return;
  }
  throw new Error("error_operation");
}

chrome.commands.onCommand.addListener(command => {
  if (["open-little-window", "open-little-window-fallback"].includes(command)) serialized(openLauncher).catch(console.error);
});
chrome.action.onClicked.addListener(() => serialized(openLauncher).catch(console.error));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "focus-input") return false;
  serialized(() => dispatch(message, sender)).then(
    result => sendResponse({ ...result, ok: true }),
    error => sendResponse({ ok: false, error: ERROR_CODES.has(error?.message) ? error.message : "error_generic" })
  );
  return true;
});
chrome.windows.onBoundsChanged.addListener(win => {
  const known = roleCache.get(win.id);
  const ignore = updating.has(win.id);
  serialized(async () => {
    if (ignore || win.type !== "popup" || win.incognito) return;
    const tracked = (await session()).trackedWindows[win.id];
    if (!tracked || (known && (known.tabId !== tracked.tabId || known.role !== tracked.role))) return;
    // Events can arrive after a programmatic resize or after another queued
    // mutation. Reject stale geometry rather than persisting a previous role.
    try {
      const live = await chrome.windows.get(win.id);
      if (["left", "top", "width", "height", "state"].some(key => live[key] !== win[key])) return;
    } catch {
      // A final move followed immediately by closing still deserves persistence;
      // onRemoved is queued after this bounds event and will clear ownership.
    }
    await saveBounds(win, tracked.role);
  }).catch(console.error);
});
chrome.windows.onRemoved.addListener(windowId => {
  serialized(async () => {
    const state = await session();
    delete state.trackedWindows[windowId];
    roleCache.delete(windowId);
    await chrome.storage.session.set({ trackedWindows: state.trackedWindows });
    await clearLauncher(windowId);
  }).catch(console.error);
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.tabs.create({ url: SETUP_PAGE }).catch(console.error);
});
