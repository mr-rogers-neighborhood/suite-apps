import { SCHEMA_VERSION } from "@suite/budget-core";
import { describe, expect, it } from "vitest";
import manifestText from "../manifest.json?raw";

/**
 * The source manifest and Budget's document layer agree.
 *
 * The host stamps the envelope with the version the manifest declares, and the
 * pack reads a payload with the schema its core writes. A drift between the two
 * numbers would make the host refuse a document the pack can read, or accept one
 * it cannot, so this test reads the manifest the build signs.
 */
const manifest = JSON.parse(manifestText) as {
  readonly documents?: readonly {
    readonly id: string;
    readonly format: string;
    readonly version: number;
    readonly mode?: string;
  }[];
};

describe("Budget's declared document", () => {
  it("declares the one format its library writes at the core schema version", () => {
    expect(manifest.documents).toEqual([
      {
        id: "budget",
        format: "suite.budget.snapshot",
        version: SCHEMA_VERSION,
        mode: "multi",
      },
    ]);
  });
});
