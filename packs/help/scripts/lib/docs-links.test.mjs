import { describe, expect, it } from "vitest";

import { sectionPath } from "../../../../scripts/lib/audiences.mjs";
import { rewriteHref, rewriteLinks } from "./docs-links.mjs";

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
/** The section each published page declares, as `sync-docs` reads it. */
const audiences = new Map([
  ["README.md", "developer"],
  ["how-to/index.md", "user"],
  ["how-to/keys.md", "developer"],
  ["reference/README.md", "developer"],
  ["reference/index.md", "developer"],
  ["reference/decisions.md", "developer"],
  ["reference/packaging-channels.md", "developer"],
  ["tutorials/index.md", "user"],
]);
const rewrite = (href, rel) => rewriteHref(href, rel, files, dirs, audiences);

describe("sectionPath", () => {
  it("folds README and index pages to their folder route", () => {
    expect(sectionPath("user", "README.md")).toBe("/handbook");
    expect(sectionPath("developer", "reference/README.md")).toBe("/developer/reference");
    expect(sectionPath("developer", "reference/index.md")).toBe("/developer/reference");
  });

  it("keeps an ordinary page and its fragment", () => {
    expect(sectionPath("developer", "reference/decisions.md")).toBe(
      "/developer/reference/decisions",
    );
    expect(sectionPath("developer", "reference/decisions.md", "#desktop-host")).toBe(
      "/developer/reference/decisions#desktop-host",
    );
  });
});

describe("rewriteHref", () => {
  it("sends a folder index to its own section, not the retired /docs route", () => {
    expect(rewrite("tutorials/index.md", "README.md")).toBe("/handbook/tutorials");
    expect(rewrite("reference/README.md", "README.md")).toBe("/developer/reference");
  });

  it("resolves a relative page link from the page that wrote it", () => {
    expect(rewrite("../reference/decisions.md#desktop-host", "reference/ideas.md")).toBe(
      "/developer/reference/decisions#desktop-host",
    );
    expect(rewrite("packaging-channels.md#signing", "reference/keys.md")).toBe(
      "/developer/reference/packaging-channels#signing",
    );
  });

  it("keeps a cross-section link in the app, at the target's section", () => {
    expect(rewrite("../reference/decisions.md", "how-to/index.md")).toBe(
      "/developer/reference/decisions",
    );
    expect(rewrite("../tutorials/index.md", "reference/decisions.md")).toBe("/handbook/tutorials");
  });

  it("sends a link that leaves docs/ to GitHub", () => {
    expect(rewrite("../legacy/help/README.md", "README.md")).toBe(
      "https://github.com/mrrnbhd/suite-apps/blob/main/legacy/help/README.md",
    );
    expect(rewrite("../../legacy/help/README.md", "reference/help.md")).toBe(
      "https://github.com/mrrnbhd/suite-apps/blob/main/legacy/help/README.md",
    );
    expect(rewrite("../legacy/canvas/handbook/", "README.md")).toBe(
      "https://github.com/mrrnbhd/suite-apps/tree/main/legacy/canvas/handbook/",
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

  it("does not guess a section when the target has no audience", () => {
    expect(rewriteHref("reference/decisions.md", "README.md", files, dirs, new Map())).toBe(
      "reference/decisions.md",
    );
    expect(rewriteHref("reference", "README.md", files, dirs, new Map())).toBe("reference");
  });
});

describe("rewriteLinks", () => {
  it("rewrites a link whose label wraps across lines", () => {
    const body = "[Packaging\nchannels](../reference/packaging-channels.md#signing) owns it.";
    expect(rewriteLinks(body, "how-to/keys.md", files, dirs, audiences)).toBe(
      "[Packaging\nchannels](/developer/reference/packaging-channels#signing) owns it.",
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
    expect(rewriteLinks(body, "how-to/keys.md", files, dirs, audiences)).toBe(
      [
        "`[x](../reference/decisions.md)` stays literal.",
        "",
        "```md",
        "[x](../reference/decisions.md)",
        "```",
        "",
        "![diagram](./diagram.png) and [real](/developer/reference/decisions).",
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
        audiences,
      ),
    ).toBe(
      "[`RELEASES.md`](https://github.com/mrrnbhd/suite-apps/blob/main/RELEASES.md) is the mirror.",
    );
  });
});
