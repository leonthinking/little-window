import { resolveInput } from "./core.js";
import { loadLanguage, t, applyTranslations, errorText, request } from "./i18n.js";

const input = document.querySelector("#query");
const form = document.querySelector("#search-form");
const submit = document.querySelector("#submit");
const error = document.querySelector("#error");
const language = document.querySelector("#language");
const historyList = document.querySelector("#history-list");
const clearHistory = document.querySelector("#clear-history");
let composing = false;
let busy = false;
let history = [];
let languagePreference = "auto";
let errorCode = "";
let ready = false;
let currentWindowId;
let languageMenuOpen = false;

function availableScreen() {
  return { left: screen.availLeft ?? 0, top: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight };
}

function showError(reason = "") {
  errorCode = typeof reason === "string" ? reason : reason?.message || "error_generic";
  error.textContent = errorCode ? errorText(errorCode) : "";
  error.hidden = !errorCode;
  input.setAttribute("aria-invalid", errorCode ? "true" : "false");
}

function renderIntent() {
  let key = "intent_search";
  if (input.value.trim()) {
    try { if (resolveInput(input.value).kind === "url") key = "intent_url"; }
    catch { /* Typing stays uninterrupted; validate only when submitting. */ }
  }
  document.querySelector("#intent").textContent = t(key);
}

function renderHistory() {
  const focused = document.activeElement;
  const previousId = focused?.closest("[data-history-id]")?.dataset.historyId;
  const previousAction = focused?.dataset.action;
  historyList.replaceChildren();
  for (const item of history) {
    if (!item || typeof item.id !== "string" || typeof item.input !== "string") continue;
    const row = document.createElement("li");
    row.dataset.historyId = item.id;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    open.dataset.action = "open";
    open.disabled = busy;
    open.setAttribute("aria-label", t("history_open", { input: item.input }));
    open.title = item.input;
    const icon = document.createElement("span");
    icon.className = "history-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.kind === "url" ? "↗" : "⌕";
    const label = document.createElement("span");
    label.className = "history-label";
    label.textContent = item.input;
    open.append(icon, label);
    open.addEventListener("click", () => browse(item.input));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-remove icon-button";
    remove.dataset.action = "remove";
    remove.textContent = "×";
    remove.disabled = busy;
    remove.setAttribute("aria-label", t("history_remove", { input: item.input }));
    remove.title = t("history_remove", { input: item.input });
    remove.addEventListener("click", () => mutateHistory({ type: "history-remove", id: item.id }));
    row.append(open, remove);
    historyList.append(row);
  }
  document.querySelector("#history-empty").hidden = historyList.children.length > 0;
  clearHistory.disabled = busy || historyList.children.length === 0;
  if (previousId) {
    const row = [...historyList.children].find(node => node.dataset.historyId === previousId);
    const replacement = row?.querySelector(`[data-action="${previousAction === "remove" ? "remove" : "open"}"]`);
    (replacement || historyList.querySelector("button") || input).focus();
  }
}

async function renderLanguage() {
  if (!await loadLanguage(languagePreference)) return;
  applyTranslations();
  document.title = t("brand");
  language.value = languagePreference;
  renderIntent();
  renderHistory();
  showError(errorCode);
}

async function mutateHistory(message) {
  if (busy) return;
  try {
    const result = await request(message);
    if (Array.isArray(result.history)) { history = result.history; renderHistory(); }
  } catch (reason) { showError(reason); }
}

function setBusy(value) {
  busy = value;
  submit.disabled = value;
  input.readOnly = value;
  language.disabled = value;
  document.querySelector("#close").disabled = value;
  if (value) form.setAttribute("aria-busy", "true");
  else form.removeAttribute("aria-busy");
  renderHistory();
}

async function browse(value) {
  if (busy || composing || !ready) return;
  try { resolveInput(value); }
  catch (reason) { showError(reason); input.focus(); return; }
  input.value = value;
  renderIntent();
  setBusy(true);
  showError();
  try { await request({ type: "browse", input: value, screen: availableScreen() }); }
  catch (reason) { setBusy(false); showError(reason); input.focus(); }
}

async function close() {
  if (composing || busy) return;
  try { await request({ type: "close-launcher" }); }
  catch { window.close(); }
}

input.addEventListener("compositionstart", () => { composing = true; });
input.addEventListener("compositionend", () => { composing = false; });
input.addEventListener("input", () => { showError(); renderIntent(); });
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.isComposing || composing || event.keyCode === 229)) event.preventDefault();
  if (event.key === "ArrowDown" && !composing && !event.isComposing) {
    const first = historyList.querySelector(".history-open");
    if (first) { event.preventDefault(); first.focus(); }
  }
});
historyList.addEventListener("keydown", event => {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  const row = event.target.closest("li");
  if (!row) return;
  event.preventDefault();
  const next = event.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
  (next?.querySelector(".history-open") || (event.key === "ArrowUp" ? input : row.querySelector(".history-open"))).focus();
});
// A native select still dispatches Escape to the page before closing its menu.
// Use its actual open state when supported; the interaction state is a
// conservative fallback for older Chrome versions without the :open selector.
function languageMenuIsOpen() {
  try { return language.matches(":open"); }
  catch { return languageMenuOpen; }
}
language.addEventListener("pointerdown", () => { languageMenuOpen = true; });
language.addEventListener("keydown", event => {
  if ([" ", "Enter", "F4"].includes(event.key) || (event.altKey && event.key === "ArrowDown")) languageMenuOpen = true;
});
language.addEventListener("change", () => { languageMenuOpen = false; });
language.addEventListener("blur", () => { languageMenuOpen = false; });
document.addEventListener("pointerdown", event => {
  if (event.target !== language) languageMenuOpen = false;
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || composing) return;
  if (event.target === language && languageMenuIsOpen()) {
    languageMenuOpen = false;
    return; // Let the browser dismiss the native menu first.
  }
  event.preventDefault();
  close();
});
document.querySelector("#close").addEventListener("click", close);
clearHistory.addEventListener("click", () => mutateHistory({ type: "history-clear" }));
form.addEventListener("submit", event => { event.preventDefault(); browse(input.value); });
language.addEventListener("change", async () => {
  try {
    await request({ type: "set-language", language: language.value });
    languagePreference = language.value;
    await renderLanguage();
  } catch (reason) { language.value = languagePreference; showError(reason); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.history) { history = Array.isArray(changes.history.newValue) ? changes.history.newValue : []; renderHistory(); }
  if (changes.language) { languagePreference = changes.language.newValue || "auto"; renderLanguage().catch(showError); }
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "focus-input" && message.windowId === currentWindowId) { input.focus(); input.select(); }
});
window.addEventListener("focus", () => { if (document.activeElement === document.body) input.focus(); });
window.addEventListener("pageshow", event => { if (event.persisted) { setBusy(false); initialize(); } });

async function initialize() {
  try {
    currentWindowId = (await chrome.windows.getCurrent()).id;
    const state = await request({ type: "get-state" });
    history = Array.isArray(state.history) ? state.history : [];
    languagePreference = state.language || "auto";
    await renderLanguage();
    await request({ type: "launcher-ready", screen: availableScreen() });
    ready = true;
  } catch (reason) {
    await loadLanguage(languagePreference).catch(() => {});
    applyTranslations();
    showError(reason);
  }
  input.focus();
}
initialize();
