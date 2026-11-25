import type {
  BaseData,
  FolderNode,
  ModuleSummary,
  SearchEntry,
  Tour,
  TourMembership,
} from "./explorer-types";

/** The five generated files the explorer opens with. */
export const BASE_DATA_FILES = [
  "tree.json",
  "modules.json",
  "search.json",
  "tours.json",
  "tour-membership.json",
] as const;

/** The smallest fetch shape the loader needs, so a test supplies no server. */
export type DataFetch = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status?: number;
  json: () => Promise<unknown>;
}>;

/** Read one JSON file, saying which one failed when it does. */
export async function readJson<T>(fetcher: DataFetch, url: string): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status ?? "an error"}`);
  return (await response.json()) as T;
}

/**
 * Load the explorer's starting data.
 *
 * The files are generated together by `pnpm docs:index`, so a partial answer is
 * not a usable state: a missing one fails the whole load and the window says
 * which file to regenerate.
 */
export async function loadBaseData(fetcher: DataFetch): Promise<BaseData> {
  const [tree, modules, search, tours, membership] = await Promise.all([
    readJson<FolderNode>(fetcher, "/data/tree.json"),
    readJson<ModuleSummary[]>(fetcher, "/data/modules.json"),
    readJson<SearchEntry[]>(fetcher, "/data/search.json"),
    readJson<Tour[]>(fetcher, "/data/tours.json"),
    readJson<TourMembership>(fetcher, "/data/tour-membership.json"),
  ]);
  return { tree, modules, search, tours, membership };
}
