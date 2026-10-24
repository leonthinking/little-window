import { loadLanguage, t, applyTranslations, errorText, request } from "./i18n.js";

const status = document.querySelector("#status");
const language = document.querySelector("#language");
const isMac = /Mac/i.test(navigator.platform);
let languagePreference = "auto";
let loaded = false;

function displayKey(value) {
  if (!value) return t("shortcut_unbound");
  if (!isMac) return value;
  return value.replace(/Command/g, "⌘").replace(/MacCtrl/g, "⌃").replace(/Ctrl/g, "⌘").replace(/Alt|Option/g, "⌥").replace(/Shift/g, "⇧").replace(/\+/g, "");
}

async function refresh() {
  if (!loaded) return;
  try {
    const commands = await chrome.commands.getAll();
    status.textContent = t("shortcut_status", {
      primary: displayKey(commands.find(({ name }) => name === "open-little-window")?.shortcut),
      fallback: displayKey(commands.find(({ name }) => name === "open-little-window-fallback")?.shortcut)
    });
  } catch { status.textContent = t("shortcut_failed"); }
}

async function renderLanguage() {
  if (!await loadLanguage(languagePreference)) return;
  loaded = true;
  applyTranslations();
  document.title = t("setup_title");
  document.querySelector("#usage-text").textContent = t("usage_text", { closeKey: isMac ? "⌘W" : "Ctrl+W" });
  language.value = languagePreference;
  await refresh();
}

document.querySelector("#shortcuts").addEventListener("click", async () => {
  try { await chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); }
  catch { status.textContent = t("shortcut_open_failed"); }
});
document.querySelector("#try").addEventListener("click", async () => {
  try { await request({ type: "open-launcher" }); }
  catch (reason) { status.textContent = errorText(reason); }
});
document.querySelector("#refresh").addEventListener("click", refresh);
language.addEventListener("change", async () => {
  try {
    await request({ type: "set-language", language: language.value });
    languagePreference = language.value;
    await renderLanguage();
  } catch (reason) { language.value = languagePreference; status.textContent = errorText(reason); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.language) {
    languagePreference = changes.language.newValue || "auto";
    renderLanguage().catch(reason => { status.textContent = errorText(reason); });
  }
});
window.addEventListener("focus", refresh);
try {
  const state = await request({ type: "get-state" });
  languagePreference = state.language || "auto";
  await renderLanguage();
} catch (reason) {
  await loadLanguage().catch(() => {});
  applyTranslations();
  status.textContent = errorText(reason);
}
