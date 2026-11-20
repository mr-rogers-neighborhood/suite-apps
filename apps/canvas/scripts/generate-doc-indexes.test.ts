import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// The generator is a script, so it ships without types; this test is its contract.
// @ts-expect-error -- a .mjs module has no declaration file
import { generateIndexes } from "./generate-doc-indexes.mjs";

const silent = { log: () => {}, error: () => {} };
const roots: string[] = [];

function git(root: string, args: string[]) {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
}

function commitAll(root: string, message: string) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
}

/** A checkout with one committed page and four generated, committed indexes. */
function newRepo() {
  const root = mkdtempSync(join(tmpdir(), "doc-indexes-"));
  roots.push(root);
  for (const section of ["tutorials", "how-to", "reference", "explanation"]) {
    mkdirSync(join(root, "docs", section), { recursive: true });
    writeFileSync(join(root, "docs", section, "index.md"), "");
  }
  writeFileSync(join(root, "docs/how-to/page.md"), "# A page\n\nFirst paragraph.\n");
  git(root, ["init", "-q", "-b", "main"]);
  commitAll(root, "docs: add a page");
  expect(generateIndexes({ root, log: silent }).refused).toEqual([]);
  commitAll(root, "docs: generate the indexes");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("generated doc indexes", () => {
  it("passes a check on the tree it was generated from", () => {
    const root = newRepo();
    expect(generateIndexes({ root, check: true, log: silent })).toEqual({
      refused: [],
      unverified: [],
      stale: [],
      wrote: [],
    });
  });

  it("refuses to date a page with uncommitted changes and writes nothing", () => {
    const root = newRepo();
    const page = join(root, "docs/how-to/page.md");
    const index = join(root, "docs/how-to/index.md");
    const before = readFileSync(index, "utf8");
    writeFileSync(page, "# A page\n\nEdited but not committed.\n");

    const result = generateIndexes({ root, log: silent });
    expect(result.refused).toEqual([page]);
    expect(result.wrote).toEqual([]);
    expect(readFileSync(index, "utf8")).toBe(before);
  });

  it("leaves a section unverified while its page has no commit", () => {
    const root = newRepo();
    writeFileSync(join(root, "docs/how-to/page.md"), "# A page\n\nPending edit.\n");

    const result = generateIndexes({ root, check: true, log: silent });
    expect(result.unverified).toEqual([join(root, "docs/how-to/index.md")]);
    expect(result.stale).toEqual([]);
  });

  it("dates a page from its own commit, so the index commit leaves the check green", () => {
    const root = newRepo();
    const page = join(root, "docs/how-to/page.md");
    const index = join(root, "docs/how-to/index.md");
    writeFileSync(page, "# A page\n\nCommitted first.\n");
    commitAll(root, "docs: edit the page");

    const result = generateIndexes({ root, log: silent });
    expect(result.refused).toEqual([]);
    expect(result.wrote).toEqual([index]);
    expect(readFileSync(index, "utf8")).toMatch(
      /\| \[A page\]\(page\.md\) \| Committed first\. \| \d{4}-\d{2}-\d{2} \|/,
    );

    commitAll(root, "docs: regenerate the index");
    expect(generateIndexes({ root, check: true, log: silent }).stale).toEqual([]);
  });

  it("refuses a page that has never been committed", () => {
    const root = newRepo();
    const page = join(root, "docs/how-to/new.md");
    writeFileSync(page, "# New page\n\nBody.\n");

    expect(generateIndexes({ root, log: silent }).refused).toEqual([page]);
  });

  it("still fails the check when a committed page changed after the index", () => {
    const root = newRepo();
    writeFileSync(join(root, "docs/how-to/page.md"), "# A page\n\nSecond paragraph.\n");
    commitAll(root, "docs: change the page without the index");

    expect(generateIndexes({ root, check: true, log: silent }).stale).toEqual([
      join(root, "docs/how-to/index.md"),
    ]);
  });
});
