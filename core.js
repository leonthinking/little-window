export const LAUNCHER_SIZE = Object.freeze({ width: 664, height: 470 });
export const BROWSER_SIZE = Object.freeze({ width: 1000, height: 760 });

// A query always stays text; only clearly recognizable web addresses navigate.
export function resolveInput(raw) {
  if (typeof raw !== "string") throw new Error("error_input");
  const text = raw.trim();
  if (!text) throw new Error("error_empty");
  if (text.length > 8192) throw new Error("error_too_long");
  if (/^(?:javascript|data|file|chrome|chrome-extension|about|vbscript|blob):/i.test(text)) {
    throw new Error("error_scheme");
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) {
    throw new Error("error_scheme");
  }
  const explicit = /^https?:\/\//i.test(text);
  const bare = /^(?:localhost(?::\d+)?|\[[0-9a-f:]+\](?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|(?:[^\s./:@]+\.)+[\p{L}][\p{L}\p{N}-]*(?::\d+)?)(?:[/?#][^\s]*)?$/iu.test(text);
  if (!explicit && !bare) return { kind: "search", text };
  const local = /^(?:localhost(?=[:/?#]|$)|\[|(?:\d{1,3}\.){3}\d{1,3}(?=[:/?#]|$))/i.test(text);
  let url;
  try {
    url = new URL(explicit ? text : `${local ? "http" : "https"}://${text}`);
  } catch {
    throw new Error("error_url");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error("error_url");
  }
  if (url.username || url.password) throw new Error("error_credentials");
  return { kind: "url", url: url.href };
}

export function screenBounds(value) {
  const valid = value && [value.left, value.top, value.width, value.height].every(Number.isFinite);
  if (!valid || value.width < 100 || value.height < 100) return null;
  // Treat messages as untrusted, while allowing monitors to the left of the main one.
  if (Math.abs(value.left) > 100000 || Math.abs(value.top) > 100000 || value.width > 30000 || value.height > 30000) return null;
  return { left: Math.round(value.left), top: Math.round(value.top), width: Math.round(value.width), height: Math.round(value.height) };
}

export function centeredBounds(area, size, vertical = 0.5) {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return {
    width, height,
    left: Math.round(area.left + (area.width - width) / 2),
    top: Math.round(area.top + (area.height - height) * vertical)
  };
}
