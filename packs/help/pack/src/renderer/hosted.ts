import { type MenuBarBridge, menuBarBridge } from "@suite/ui";
import { useEffect, useState } from "react";

/**
 * The host's bar, when one is driving this pack.
 *
 * A standalone Help draws its own header; under Suite Desk the host owns the bar and the
 * pack publishes what belongs in it. The bridge is the same one Canvas, Planner and Budget
 * use, so Help's surface is not a special case.
 */
export function useHostedMenuBar(): MenuBarBridge | null {
  return useState(() => menuBarBridge(globalThis))[0];
}

/**
 * Whether the window is wide enough for the navigator column.
 *
 * The shared `AppShell` stacks its navigation above the content below `md`; Help needs a
 * drawer instead, because a stacked rail would take half a phone screen and push the
 * document off it. jsdom has no `matchMedia`, and a missing query is the desktop
 * arrangement, which is the shape the existing tests describe.
 */
export function useWideViewport(query = "(min-width: 768px)"): boolean {
  const [wide, setWide] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia(query).matches : true,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return wide;
}
