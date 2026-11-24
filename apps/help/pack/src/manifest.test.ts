import { describe, expect, it } from "vitest";
import packageText from "../../package.json?raw";
import manifestText from "../manifest.json?raw";

/**
 * Help's source manifest and the app that owns it agree.
 *
 * Help has no document of its own and no host service to call, so its capability list is empty on
 * purpose. A list that is empty because nothing was written looks the same as one that is empty by
 * decision; this test is the decision, and the README says why.
 */
const manifest = JSON.parse(manifestText) as {
  readonly id: string;
  readonly version: string;
  readonly entry: string;
  readonly capabilities: readonly string[];
  readonly documents?: unknown;
};

const app = JSON.parse(packageText) as { readonly version: string };

describe("Help's source manifest", () => {
  it("names the app's one version and its generated entry", () => {
    expect(manifest.id).toBe("help");
    expect(manifest.version).toBe(app.version);
    expect(manifest.entry).toBe("index.html");
  });

  it("asks the host for nothing beyond the bundle", () => {
    // The generated index and the compiled handbook pages are the pack's payload. Help reads them
    // from its own origin, writes no document and opens no file, so every capability would be a
    // claim it does not use.
    expect(manifest.capabilities).toEqual([]);
    expect(manifest.documents).toBeUndefined();
  });
});
