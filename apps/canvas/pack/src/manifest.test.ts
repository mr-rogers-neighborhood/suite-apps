import { SCHEMA_VERSION, WORKSPACE_FILE_KIND } from "@suite/graph";
import { describe, expect, it } from "vitest";
import manifestText from "../manifest.json?raw";

/**
 * The source manifest and Canvas's document layer agree.
 *
 * The host stamps the envelope with the version the manifest declares, and the pack reads a payload
 * with the schema its graph writes. A drift between the two numbers would make the host refuse a
 * document the pack can read, or accept one it cannot, so this test reads the manifest the build
 * signs.
 *
 * The capability list is asserted too: it is what this pack actually uses, not every service the
 * vocabulary offers. Sync is deliberately absent — there is no host relay service, and the pack
 * carries no transport of its own.
 */
const manifest = JSON.parse(manifestText) as {
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly platforms?: readonly string[];
  readonly documents?: readonly {
    readonly id: string;
    readonly format: string;
    readonly version: number;
    readonly mode?: string;
  }[];
};

describe("Canvas's declared document", () => {
  it("declares the .canvas workspace at the current schema", () => {
    expect(manifest.documents).toEqual([
      {
        id: "canvas",
        format: WORKSPACE_FILE_KIND,
        version: SCHEMA_VERSION,
        mode: "multi",
      },
    ]);
  });

  it("asks the host only for what it uses", () => {
    // `documents` holds the workspace and its reveal/watch surface; `files` is the picker export,
    // import and folder import; `recents` is the host's recent list. The pack asks for no path and
    // no filesystem of its own, and sync is still a host gap rather than a capability to claim.
    expect(manifest.capabilities).toEqual(["documents", "files", "recents"]);
  });

  it("declares the desktop host it needs", () => {
    // Canvas needs a file picker and a document folder, which the mobile host does not serve.
    expect(manifest.platforms).toEqual(["desktop"]);
  });
});
