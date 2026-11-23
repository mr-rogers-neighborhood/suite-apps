import { describe, expect, it } from "vitest";

import { handbookPathForDocsFile, rewriteHref, rewriteLinks } from "./docs-links.mjs";

const files = new Set([
  "README.md",
  "how-to/index.md",
  "how-to/keys.md",
  "reference/README.md",
  "reference/index.md",
  "reference/decisions.md",
  "reference/packaging-channels.md",
  "tutorials/index.md",
]);
const dirs = new Set(["how-to", "reference", "tutorials"]);
const rewrite = (href, rel) => rewriteHref(href, rel, files, dirs);

describe("handbookPathForDocsFile", () => {
  it("folds README and index pages to their folder route", () => {
    expect(handbookPathForDocsFile("README.md")).toBe("/handbook");
    expect(handbookPathForDocsFile("reference/README.md")).toBe("/handbook/reference");
    expect(handbookPathForDocsFile("reference/index.md")).toBe("/handbook/reference");
  });

  it("keeps an ordinary page and its fragment", () => {
    expect(handbookPathForDocsFile("reference/decisions.md")).toBe("/handbook/reference/decisions");
    expect(handbookPathForDocsFile("reference/decisions.md", "#desktop-host")).toBe(
      "/handbook/reference/decisions#desktop-host",
    );
  });
});

describe("rewriteHref", () => {
  it("points a folder index at the handbook, not the retired /docs route", () => {
    expect(rewrite("tutorials/index.md", "README.md")).toBe("/handbook/tutorials");
    expect(rewrite("reference/README.md", "README.md")).toBe("/handbook/reference");
  });

  it("resolves a relative page link from the page that wrote it", () => {
    expect(rewrite("../reference/decisions.md#desktop-host", "reference/ideas.md")).toBe(
      "/handbook/reference/decisions#desktop-host",
    );
    expect(rewrite("packaging-channels.md#signing", "reference/keys.md")).toBe(
      "/handbook/reference/packaging-channels#signing",
    );
  });

  it("sends a link that leaves docs/ to GitHub", () => {
    expect(rewrite("../apps/help/README.md", "README.md")).toBe(
      "https://github.com/mrrnbhd/suite-apps/blob/main/apps/help/README.md",
    );
    expect(rewrite("../../apps/help/README.md", "reference/help.md")).toBe(
      "https://github.com/mrrnbhd/suite-apps/blob/main/apps/help/README.md",
    );
    expect(rewrite("../apps/canvas/handbook/", "README.md")).toBe(
      "https://github.com/mrrnbhd/suite-apps/tree/main/apps/canvas/handbook/",
    );
  });

  it("leaves external links, anchors and absolute paths alone", () => {
    expect(rewrite("https://example.com/a.md", "README.md")).toBe("https://example.com/a.md");
    expect(rewrite("mailto:maintainers@suite.run", "README.md")).toBe(
      "mailto:maintainers@suite.run",
    );
    expect(rewrite("#editing-rules", "README.md")).toBe("#editing-rules");
    expect(rewrite("/handbook/reference/commands", "README.md")).toBe(
      "/handbook/reference/commands",
    );
  });

  it("does not invent a route for a page that was not generated", () => {
    expect(rewrite("missing.md", "README.md")).toBe("missing.md");
  });
});

describe("rewriteLinks", () => {
  it("rewrites a link whose label wraps across lines", () => {
    const body = "[Packaging\nchannels](../reference/packaging-channels.md#signing) owns it.";
    expect(rewriteLinks(body, "how-to/keys.md", files, dirs)).toBe(
      "[Packaging\nchannels](/handbook/reference/packaging-channels#signing) owns it.",
    );
  });

  it("keeps fenced code, inline code and images unchanged", () => {
    const body = [
      "`[x](../reference/decisions.md)` stays literal.",
      "",
      "```md",
      "[x](../reference/decisions.md)",
      "```",
      "",
      "![diagram](./diagram.png) and [real](../reference/decisions.md).",
    ].join("\n");
    expect(rewriteLinks(body, "how-to/keys.md", files, dirs)).toBe(
      [
        "`[x](../reference/decisions.md)` stays literal.",
        "",
        "```md",
        "[x](../reference/decisions.md)",
        "```",
        "",
        "![diagram](./diagram.png) and [real](/handbook/reference/decisions).",
      ].join("\n"),
    );
  });

  it("rewrites a link whose label is inline code", () => {
    expect(
      rewriteLinks(
        "[`RELEASES.md`](../../RELEASES.md) is the mirror.",
        "how-to/keys.md",
        files,
        dirs,
      ),
    ).toBe(
      "[`RELEASES.md`](https://github.com/mrrnbhd/suite-apps/blob/main/RELEASES.md) is the mirror.",
    );
  });
});
