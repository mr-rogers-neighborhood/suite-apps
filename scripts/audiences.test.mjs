import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUDIENCES,
  audienceProblem,
  docsSlug,
  readAudience,
  sectionPath,
  splitFrontmatter,
} from "./lib/audiences.mjs";

describe("readAudience", () => {
  it("reads the declared audience", () => {
    assert.deepEqual(readAudience("---\naudience: user\n---\n\n# Page\n"), { audience: "user" });
    assert.deepEqual(readAudience('---\naudience: "developer"\ntitle: X\n---\n'), {
      audience: "developer",
    });
  });

  it("names the reason a page has no audience", () => {
    assert.match(audienceProblem("# Page\n"), /no frontmatter/u);
    assert.match(audienceProblem("---\ntitle: X\n---\n"), /no `audience` key/u);
    assert.match(
      audienceProblem("---\naudience: everyone\n---\n"),
      /must be `user` or `developer`/u,
    );
  });

  it("does not accept a value only one section uses", () => {
    assert.equal(audienceProblem("---\naudience: developers\n---\n")?.includes("developers"), true);
  });
});

describe("splitFrontmatter", () => {
  it("keeps the body after the block", () => {
    assert.deepEqual(splitFrontmatter("---\naudience: user\n---\n\n# Page\n"), {
      frontmatter: "audience: user",
      body: "\n# Page\n",
    });
  });

  it("returns null without a complete block", () => {
    assert.equal(splitFrontmatter("# Page\n"), null);
    assert.equal(splitFrontmatter("---\naudience: user\n"), null);
  });
});

describe("the section URL", () => {
  it("folds README and index pages to their folder", () => {
    assert.equal(docsSlug("README.md"), "");
    assert.equal(docsSlug("reference/README.md"), "reference");
    assert.equal(docsSlug("reference/index.md"), "reference");
    assert.equal(sectionPath("user", "how-to/keys.md"), "/handbook/how-to/keys");
    assert.equal(sectionPath("developer", "spec/README.md", "#clauses"), "/developer/spec#clauses");
    assert.equal(sectionPath("developer", "README.md"), "/developer");
  });

  it("keeps the two sections apart", () => {
    assert.deepEqual(AUDIENCES, ["user", "developer"]);
    assert.notEqual(sectionPath("user", "a.md"), sectionPath("developer", "a.md"));
  });

  it("refuses an audience that is not one of the two", () => {
    assert.throws(() => sectionPath("everyone", "a.md"), /unknown audience/u);
  });
});
