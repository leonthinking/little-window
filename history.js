import { resolveInput } from "./core.js";

export const HISTORY_LIMIT = 5;

function identity(target) {
  return target.kind === "url" ? `url:${target.url}` : `search:${target.text}`;
}

// Revalidate local data as well as incoming requests. No HTML is stored here.
export function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const items = [];
  for (const entry of value) {
    if (!entry || typeof entry.id !== "string" || entry.id.length > 100 ||
        !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) continue;
    try {
      const target = resolveInput(entry.input);
      const key = identity(target);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: entry.id, input: entry.input.trim(), kind: target.kind, updatedAt: entry.updatedAt });
      if (items.length === HISTORY_LIMIT) break;
    } catch { /* Ignore corrupt or no longer supported entries. */ }
  }
  return items;
}

export function addHistory(value, input, now = Date.now(), id = crypto.randomUUID()) {
  const target = resolveInput(input);
  const key = identity(target);
  const remaining = cleanHistory(value).filter(entry => identity(resolveInput(entry.input)) !== key);
  return [{ id, input: input.trim(), kind: target.kind, updatedAt: now }, ...remaining].slice(0, HISTORY_LIMIT);
}

export function removeHistory(value, id) {
  return cleanHistory(value).filter(entry => entry.id !== id);
}
