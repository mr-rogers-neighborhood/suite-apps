import { describe, expect, it } from "vitest";
import type { DataFetch } from "./explorer-data";
import { loadBaseData } from "./explorer-data";
import { docsPageUrl, readExplorerUrl } from "./explorer-routes";

const tree = {
  type: "folder" as const,
  name: "",
  path: "",
  children: [],
};

const mockFetch: DataFetch = async (url) => {
  const body = url.endsWith("tree.json")
    ? tree
    : url.endsWith("modules.json") || url.endsWith("search.json")
      ? []
      : url.endsWith("tours.json")
        ? []
        : {};
  return { ok: true, status: 200, json: async () => body };
};

describe("loadBaseData", () => {
  it("loads the six generated files into one explorer state", async () => {
    const seen: string[] = [];
    const data = await loadBaseData(async (url) => {
      seen.push(url);
      return mockFetch(url);
    });
    expect(seen).toEqual([
      "/data/tree.json",
      "/data/modules.json",
      "/data/search.json",
      "/data/tours.json",
      "/data/tour-membership.json",
      "/data/docs.json",
    ]);
    expect(data.tree).toEqual(tree);
    expect(data.modules).toEqual([]);
    expect(data.membership).toEqual({});
    expect(data.docs).toEqual([]);
  });

  it("names the file that failed rather than rendering an empty explorer", async () => {
    await expect(
      loadBaseData(async (url) =>
        url.endsWith("search.json")
          ? { ok: false, status: 404, json: async () => ({}) }
          : mockFetch(url),
      ),
    ).rejects.toThrow("/data/search.json returned 404");
  });
});

describe("readExplorerUrl", () => {
  it("accepts the current route names and the old walkthrough alias", () => {
    expect(readExplorerUrl("?view=tours&tour=start&step=2")).toEqual({
      view: "tours",
      node: undefined,
      module: undefined,
      tour: "start",
      step: 2,
      level: undefined,
    });
    expect(readExplorerUrl("?view=walkthroughs&walk=start").view).toBe("tours");
    expect(readExplorerUrl("?view=unknown").view).toBeUndefined();
  });

  it("keeps the file-level view and ignores a non-numeric step", () => {
    expect(readExplorerUrl("?view=browser&node=a.ts&level=file")).toMatchObject({
      view: "browser",
      node: "a.ts",
      level: "file",
    });
    expect(readExplorerUrl("?view=tours&step=two").step).toBeUndefined();
  });
});

describe("docsPageUrl", () => {
  const docs = [
    { path: "docs/README.md", slug: "", audience: "developer" as const },
    { path: "docs/how-to/keys.md", slug: "how-to/keys", audience: "developer" as const },
    {
      path: "docs/tutorials/01-install.md",
      slug: "tutorials/01-install",
      audience: "user" as const,
    },
  ];

  it("opens each page in the section its frontmatter names", () => {
    expect(docsPageUrl(docs, "docs/README.md")).toBe("/developer");
    expect(docsPageUrl(docs, "docs/how-to/keys.md")).toBe("/developer/how-to/keys");
    expect(docsPageUrl(docs, "docs/tutorials/01-install.md")).toBe(
      "/handbook/tutorials/01-install",
    );
  });

  it("does not invent a route for a page outside the index", () => {
    expect(docsPageUrl(docs, "docs/spec/missing.md")).toBeUndefined();
  });
});
