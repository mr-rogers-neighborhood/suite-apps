import { SCHEMA_VERSION, WORKSPACE_FILE_FORMAT } from "@suite/planner-core";
import { describe, expect, it } from "vitest";
import manifestText from "../manifest.json?raw";

/**
 * The source manifest and Planner's document layer agree.
 *
 * The host stamps the envelope with the version the manifest declares, and the pack reads a
 * payload with the schema its core writes. A drift between the two numbers would make the host
 * refuse a document the pack can read, or accept one it cannot, so this test reads the manifest
 * the build signs. The capability list and the projection entry are asserted too: they are what
 * this pack actually uses, not the list it inherited from the Go container.
 */
const manifest = JSON.parse(manifestText) as {
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly optionalCapabilities?: readonly string[];
  readonly documents?: readonly {
    readonly id: string;
    readonly format: string;
    readonly version: number;
    readonly mode?: string;
    readonly projection?: string;
  }[];
  readonly contributions?: {
    readonly commands?: readonly {
      readonly id: string;
      readonly provider?: string;
    }[];
    readonly providers?: readonly {
      readonly kind: string;
      readonly entry: string;
      readonly scopes?: readonly string[];
    }[];
  };
};

describe("Planner's declared document", () => {
  it("declares the one workspace format its core writes at the current schema", () => {
    expect(manifest.documents).toEqual([
      {
        id: "workspace",
        format: WORKSPACE_FILE_FORMAT,
        version: SCHEMA_VERSION,
        mode: "multi",
        projection: "reminders",
      },
    ]);
  });

  it("asks the host only for what it uses", () => {
    // `documents` holds the workspace; `files` is the picker and the pack's own sync
    // state; `notifications` lets the host invoke the reminder projection; `recents`
    // lists this pack's other documents. `commands` is optional: Desk serves the
    // Command Surface provider, and a host without it (Go until #227) runs the same
    // pack without offering commands. Sync is optional for the same reason (S7.1):
    // Desk serves the `relay` frame transport, and a phone without one runs the
    // same pack as a local-only planner. It never asks for a general network.
    expect(manifest.capabilities).toEqual([
      "documents",
      "files",
      "notifications",
      "recents",
    ]);
    expect(manifest.optionalCapabilities).toEqual(["relay", "commands"]);
  });

  it("declares the command and scope providers the pack binds", () => {
    expect(manifest.contributions?.providers).toEqual([
      { kind: "commands", entry: "commands", scopes: ["global"] },
      { kind: "scopes", entry: "scopes", scopes: ["today", "inbox"] },
    ]);
    expect(manifest.contributions?.commands?.map((command) => command.id)).toEqual([
      "planner.quick-task",
      "planner.today",
      "planner.inbox",
    ]);
    for (const command of manifest.contributions?.commands ?? []) {
      expect(command.provider).toBe("commands");
    }
  });
});
