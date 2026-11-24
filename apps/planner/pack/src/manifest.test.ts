import { SCHEMA_VERSION, WORKSPACE_FILE_FORMAT } from "@suite/planner-core";
import { describe, expect, it } from "vitest";
import manifestText from "../manifest.json?raw";

/**
 * The source manifest and Planner's document layer agree.
 *
 * The host stamps the envelope with the version the manifest declares, and the pack reads a
 * payload with the schema its core writes. A drift between the two numbers would make the host
 * refuse a document the pack can read, or accept one it cannot, so this test reads the manifest
 * the build signs. The capability list is asserted too: it is what this pack actually uses, not
 * the list it inherited from the Go container.
 */
const manifest = JSON.parse(manifestText) as {
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly documents?: readonly {
    readonly id: string;
    readonly format: string;
    readonly version: number;
    readonly mode?: string;
  }[];
};

describe("Planner's declared document", () => {
  it("declares the one workspace format its core writes at the current schema", () => {
    expect(manifest.documents).toEqual([
      {
        id: "workspace",
        format: WORKSPACE_FILE_FORMAT,
        version: SCHEMA_VERSION,
        mode: "multi",
      },
    ]);
  });

  it("asks the host only for what it uses", () => {
    // `documents` holds the workspace; `files` is the picker export and import cross. Reminders,
    // recents and sync are host gaps, not capabilities this pack can claim.
    expect(manifest.capabilities).toEqual(["documents", "files"]);
  });
});
