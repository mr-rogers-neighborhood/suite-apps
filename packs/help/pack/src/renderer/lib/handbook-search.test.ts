import { describe, expect, it } from "vitest";
import { filterHandbookSearch, type HandbookSearchEntry } from "./handbook-search";

const entries: HandbookSearchEntry[] = [
  {
    url: "/handbook/reference/commands",
    title: "Commands",
    description: "The root gate and the per-app checks.",
    text: "pnpm docs:index builds the explorer data.",
  },
  {
    url: "/handbook/reference/packaging-channels",
    title: "Packaging channels",
    description: "AppImage, Arch package and Flatpak.",
    text: "Flatpak owns updates for Suite Help.",
  },
];

describe("filterHandbookSearch", () => {
  it("ranks a title match above a body match", () => {
    expect(filterHandbookSearch(entries, "packaging").map((entry) => entry.title)).toEqual([
      "Packaging channels",
    ]);
    expect(filterHandbookSearch(entries, "flatpak").map((entry) => entry.title)).toEqual([
      "Packaging channels",
    ]);
  });

  it("matches every word and ignores case", () => {
    expect(filterHandbookSearch(entries, "ROOT gate")).toHaveLength(1);
    expect(filterHandbookSearch(entries, "root flatpak")).toHaveLength(0);
  });

  it("returns nothing for an empty query rather than the whole index", () => {
    expect(filterHandbookSearch(entries, "   ")).toEqual([]);
  });
});
