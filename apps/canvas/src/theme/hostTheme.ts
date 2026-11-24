import { useEffect, useState } from "react";

/**
 * The mode the host has painted, and a key that changes with the palette.
 *
 * Canvas does not choose a theme: Suite Shell (desktop) or Suite Go (mobile) owns the preset
 * and brightness and paints the resolved tokens onto the document. This module only reads
 * the answer, for the two places that cannot use CSS — Excalidraw's `theme` prop and the
 * contrast floor, which measures live role colours.
 *
 * A page opened outside a host has no `data-theme-mode`; it follows `prefers-color-scheme`,
 * which is what the browser and the host's `nativeTheme` both report.
 */
export type ResolvedTheme = "light" | "dark";

export interface HostTheme {
  readonly mode: ResolvedTheme;
  /** Changes whenever the host changes the preset or the mode, so a reader can re-read CSS. */
  readonly key: string;
}

function attribute(name: string): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.dataset[name] ?? null;
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

/** What the host says right now. */
export function hostTheme(): HostTheme {
  const painted = attribute("themeMode");
  const mode: ResolvedTheme =
    painted === "dark" || painted === "light" ? painted : prefersDark() ? "dark" : "light";
  return { mode, key: `${attribute("theme") ?? "suite"}:${mode}` };
}

/**
 * Follow the host for as long as this component lives.
 *
 * The host writes `data-theme` and `data-theme-mode` whenever it repaints; observing those
 * attributes is the subscription. `prefers-color-scheme` is the fallback for a page with no
 * host, and for the moment before the host's first paint.
 */
export function useHostTheme(): HostTheme {
  const [theme, setTheme] = useState<HostTheme>(hostTheme);

  useEffect(() => {
    const sync = () => setTheme(hostTheme());
    sync();

    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(sync);
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-theme-mode"],
    });

    const media =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    media?.addEventListener("change", sync);

    return () => {
      observer?.disconnect();
      media?.removeEventListener("change", sync);
    };
  }, []);

  return theme;
}
