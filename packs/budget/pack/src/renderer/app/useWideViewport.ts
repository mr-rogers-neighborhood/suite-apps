import { useEffect, useState } from "react";

/**
 * Whether the window is wide enough for the desktop rail.
 *
 * `AppShell` stacks its navigation above the content below `md`, but Budget's phone layout is a
 * bottom bar. Omitting the navigation below the breakpoint keeps the shared frame without
 * spending a phone's height on a rail the bottom bar already replaces. jsdom has no `matchMedia`;
 * a missing query is the desktop arrangement, which is the shape the existing tests describe.
 */
export function useWideViewport(): boolean {
  const query = "(min-width: 768px)";
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
  }, []);

  return wide;
}
