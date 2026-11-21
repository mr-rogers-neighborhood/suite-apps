/** One page in the offline handbook search index written by `sync-docs`. */
export type HandbookSearchEntry = {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly text: string;
};

/** Filter the generated index without a server or an external index. */
export function filterHandbookSearch(
  entries: readonly HandbookSearchEntry[],
  query: string,
): readonly HandbookSearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const words = needle.split(/\s+/u).filter((word) => word.length > 0);
  return entries
    .map((entry) => {
      const title = entry.title.toLowerCase();
      const body = `${entry.description}\n${entry.text}`.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (title.includes(word)) score += 4;
        else if (body.includes(word)) score += 1;
        else return { entry, score: 0 };
      }
      return { entry, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.entry.title.localeCompare(right.entry.title),
    )
    .slice(0, 30)
    .map((candidate) => candidate.entry);
}
