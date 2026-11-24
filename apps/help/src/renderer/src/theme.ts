/**
 * The mode this pack is drawn in.
 *
 * Help has no theme setting: the host (Suite Shell on desktop, Go on mobile) owns the preset
 * and the brightness, paints the resolved tokens onto the document, and marks the root with
 * `data-theme-mode`. This module only reads that answer for the one consumer that cannot use
 * CSS — Shiki, which needs to pick a syntax theme.
 *
 * Nothing here stores or chooses anything. A page opened outside a host keeps whatever the
 * stylesheet's fallback says.
 */
export type ResolvedTheme = "light" | "dark";

/** The mode the host has painted onto the document right now. */
export function resolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  const painted = document.documentElement.dataset.themeMode;
  if (painted === "dark" || painted === "light") return painted;
  // No host has painted. Follow the desktop, which is what the fallback stylesheet does.
  return typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Run `listener` whenever the painted mode changes.
 *
 * The host owns the attribute, so observing it is the one honest subscription: a code view
 * that needs Shiki's theme follows the host without keeping a second copy of the choice.
 */
export function observeResolvedTheme(listener: (mode: ResolvedTheme) => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(() => listener(resolvedTheme()));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-mode"],
  });
  return () => observer.disconnect();
}
