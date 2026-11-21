import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The hub reads `suite.app.json`, not `package.json`.
 *
 * `electron-builder` names the packaged app from `package.json`, and
 * `scripts/flatpak.mjs` copies the manifest beside it. When the two versions
 * drift, Start's card shows a version the app is not. The package is the source
 * of truth; this keeps the manifest in step.
 */
function readJson(relative: string): { version?: unknown } {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8")) as {
    version?: unknown;
  };
}

describe("suite.app.json", () => {
  it("reports the same version as package.json", () => {
    expect(readJson("../../suite.app.json").version).toBe(readJson("../../package.json").version);
  });
});
