import type { View } from "./explorer-types";

export type UrlState = {
  readonly view?: View | undefined;
  readonly node?: string | undefined;
  readonly module?: string | undefined;
  readonly tour?: string | undefined;
  readonly step?: number | undefined;
  readonly level?: "file" | "symbol" | undefined;
};

/** Read the explorer's state from a query string, ignoring unknown spellings. */
export function readExplorerUrl(search: string): UrlState {
  const params = new URLSearchParams(search);
  const rawView = params.get("view");
  const view =
    rawView === "walkthroughs"
      ? "tours"
      : rawView === "browser" || rawView === "modules" || rawView === "tours"
        ? rawView
        : undefined;
  const rawStep = params.get("step") ?? params.get("tstep");
  const step = rawStep === null ? undefined : Number(rawStep);
  const level = params.get("level");
  return {
    view,
    node: params.get("node") ?? undefined,
    module: params.get("module") ?? undefined,
    tour: params.get("tour") ?? params.get("walk") ?? undefined,
    step: Number.isFinite(step) ? step : undefined,
    level: level === "file" || level === "symbol" ? level : undefined,
  };
}

/**
 * The handbook URL for one page under `docs/`.
 *
 * The sync step turns `README.md` into a folder index and `foo.md` into `foo`,
 * so the explorer's `doc` tour target uses the same mapping rather than a second
 * convention.
 */
export function handbookPathForDocsFile(path: string): string {
  const relative = path.replace(/^docs\/?/u, "").replace(/\.mdx?$/iu, "");
  const slug = relative
    .replace(/(^|\/)README$/iu, "$1index")
    .replace(/(^|\/)index$/iu, "$1")
    .replace(/\/+$/u, "");
  return slug === "" ? "/handbook" : `/handbook/${slug}`;
}

/** The explorer query string for one view, without the route. */
export function explorerHref(params: {
  readonly view: View;
  readonly node?: string | null;
  readonly module?: string | null;
  readonly tour?: string | null;
  readonly step?: number;
  readonly level?: "file" | null;
}): string {
  const search = new URLSearchParams();
  search.set("view", params.view);
  if (params.view === "browser" && params.node) search.set("node", params.node);
  if (params.view === "modules" && params.module) search.set("module", params.module);
  if (params.view === "tours" && params.tour) {
    search.set("tour", params.tour);
    if (params.step !== undefined && params.step >= 0) search.set("step", String(params.step));
  }
  if (params.view === "tours" && params.level === "file") search.set("level", "file");
  return `/explore?${search.toString()}`;
}
