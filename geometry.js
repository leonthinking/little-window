import { centeredBounds, screenBounds } from "./core.js";

export function normalBounds(win) {
  if (win?.state !== "normal") return null;
  return screenBounds(win);
}

// Preserve a remembered position when possible, then fit the whole window onto
// the screen Chrome reports for the launcher (including negative coordinates).
export function restoredBounds(saved, area, fallbackSize, vertical = 0.5) {
  const remembered = screenBounds(saved);
  const available = screenBounds(area);
  if (!available) return remembered || { ...fallbackSize };
  if (!remembered) return centeredBounds(available, fallbackSize, vertical);
  const width = Math.min(remembered.width, available.width);
  const height = Math.min(remembered.height, available.height);
  return {
    width,
    height,
    left: Math.min(Math.max(remembered.left, available.left), available.left + available.width - width),
    top: Math.min(Math.max(remembered.top, available.top), available.top + available.height - height)
  };
}
