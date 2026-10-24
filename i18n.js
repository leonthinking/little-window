const catalogs = new Map();
let messages = {};
let generation = 0;

export function resolveLanguage(preference = "auto", browserLanguage = chrome.i18n.getUILanguage()) {
  if (["en", "zh_CN"].includes(preference)) return preference;
  return /^zh(?:[-_]|$)/i.test(browserLanguage) ? "zh_CN" : "en";
}

async function catalog(locale) {
  if (!catalogs.has(locale)) {
    catalogs.set(locale, fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`))
      .then(response => {
        if (!response.ok) throw new Error("error_generic");
        return response.json();
      }).catch(error => { catalogs.delete(locale); throw error; }));
  }
  return catalogs.get(locale);
}

export async function loadLanguage(preference = "auto") {
  const current = ++generation;
  const locale = resolveLanguage(preference);
  const next = await catalog(locale);
  if (current !== generation) return false;
  messages = next;
  document.documentElement.lang = locale === "zh_CN" ? "zh-CN" : "en";
  return true;
}

export function t(key, values = {}) {
  const message = messages[key]?.message || messages.error_generic?.message || "Please try again.";
  return message.replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(values, name) ? String(values[name]) : token);
}

export function errorText(error) {
  const key = typeof error === "string" ? error : error?.message;
  return t(Object.hasOwn(messages, key) && key.startsWith("error_") ? key : "error_generic");
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n); });
  for (const [attribute, dataset] of [["aria-label", "i18nAria"], ["title", "i18nTitle"], ["placeholder", "i18nPlaceholder"]]) {
    root.querySelectorAll(`[data-${dataset.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}]`)
      .forEach(node => node.setAttribute(attribute, t(node.dataset[dataset])));
  }
}

export async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "error_generic");
  return response;
}
