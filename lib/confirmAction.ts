/**
 * `window.confirm` for destructive actions, safe when `confirm` is missing (e.g. some WebViews).
 */
export function confirmDestructive(message: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.confirm(message);
  } catch {
    return false;
  }
}
