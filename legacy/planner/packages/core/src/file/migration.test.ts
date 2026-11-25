import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WorkspaceSchemaError } from "../loro/meta";
import { WorkspaceDocument } from "../loro/WorkspaceDocument";
import { SCHEMA_VERSION } from "../schema";
import { decodeWorkspaceFile, encodeWorkspaceFile } from "./workspaceFile";

/**
 * The migration guarantee, exercised with files rather than with mocks.
 *
 * `workspace-v1.planner` is the shape an older Planner left on disk: schema 1, no
 * `notificationsAskedAt`. `workspace-v3.planner` is a document a newer Planner would write. Both
 * are opened through the same decode path the app uses, so a change that stops either direction
 * from working fails here.
 */
function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

function snapshotBytes(name: string): Uint8Array {
  const parsed = JSON.parse(fixture(name)) as { snapshot: string };
  return Buffer.from(parsed.snapshot, "base64");
}

describe("a file written by an older Planner", () => {
  it("should open, keep its records, and carry the current schema and its defaults", () => {
    const decoded = decodeWorkspaceFile(fixture("workspace-v1.planner"));
    expect(decoded.isOk()).toBe(true);
    if (decoded.isErr()) return;

    const document = WorkspaceDocument.fromSnapshot(decoded.value);
    const snapshot = document.getSnapshot();

    expect(document.migratedFrom).toBe(1);
    expect(snapshot.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snapshot.settings.notificationsAskedAt).toBeNull();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]?.title).toBe("A task written by the older app");
    expect(snapshot.projects.map((project) => project.name)).toEqual(["Fixture project"]);
  });

  it("should write the upgrade, so the next open is already current", () => {
    const decoded = decodeWorkspaceFile(fixture("workspace-v1.planner"));
    if (decoded.isErr()) throw decoded.error;

    const upgraded = WorkspaceDocument.fromSnapshot(decoded.value);
    const written = encodeWorkspaceFile(upgraded);
    const envelope = JSON.parse(written) as { schemaVersion: number };

    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);

    const reopened = decodeWorkspaceFile(written);
    if (reopened.isErr()) throw reopened.error;
    expect(WorkspaceDocument.fromSnapshot(reopened.value).getSnapshot().meta.schemaVersion).toBe(
      SCHEMA_VERSION,
    );
  });
});

describe("a file written by a newer Planner", () => {
  it("should be refused by name, with both versions in the sentence", () => {
    const decoded = decodeWorkspaceFile(fixture("workspace-v3.planner"));

    expect(decoded.isErr()).toBe(true);
    if (decoded.isOk()) return;
    expect(decoded.error.code).toBe("unsupported-schema");
    expect(decoded.error.message).toContain("Suite Planner schema 3");
    expect(decoded.error.message).toContain(`up to ${SCHEMA_VERSION}`);
    expect(decoded.error.message).toContain("newer Suite Planner");
  });

  it("should be refused at the document layer too, rather than opened and overwritten", () => {
    expect(() => WorkspaceDocument.fromSnapshot(snapshotBytes("workspace-v3.planner"))).toThrow(
      WorkspaceSchemaError,
    );
    expect(() => WorkspaceDocument.fromSnapshot(snapshotBytes("workspace-v3.planner"))).toThrow(
      /schema 3; this build understands up to 2/u,
    );
  });

  it("should be refused when only the file format is newer", () => {
    const envelope = JSON.parse(fixture("workspace-v1.planner")) as Record<string, unknown>;
    const newer = JSON.stringify({ ...envelope, formatVersion: 2 });
    const decoded = decodeWorkspaceFile(newer);

    expect(decoded.isErr()).toBe(true);
    if (decoded.isOk()) return;
    expect(decoded.error.code).toBe("unsupported-version");
    expect(decoded.error.message).toContain("newer Suite Planner");
    expect(decoded.error.message).toContain("file version 2");
  });
});

describe("a new document", () => {
  it("should be born at the current schema with the field that version added", () => {
    const document = WorkspaceDocument.create();
    const snapshot = document.getSnapshot();

    expect(document.migratedFrom).toBeNull();
    expect(snapshot.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snapshot.settings.notificationsAskedAt).toBeNull();
  });
});
