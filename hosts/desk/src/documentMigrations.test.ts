import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type PackDocument, parsePackManifest } from "@suite/pack";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DocumentEntryError,
  type DocumentEntryRunner,
  DocumentMigrations,
} from "./documentMigrations.js";
import { DocumentStore } from "./documents.js";
import { migrations, projections } from "./fixtures/migration-pack/entries.js";

let root: string;
let store: DocumentStore;
let declaration: PackDocument;
let calls: string[];

const decode = (bytes: Uint8Array): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

/** The fixture pack's entries, reached the way the host reaches a declared one. */
function runner(overrides: Partial<DocumentEntryRunner> = {}): DocumentEntryRunner {
  const base: DocumentEntryRunner = {
    migrate: async (entry, document) => {
      calls.push(`${entry} ${document.from}->${document.to}`);
      const migrate = migrations[entry];
      if (migrate === undefined) throw new Error(`the fixture has no migration ${entry}`);
      await migrate(document);
    },
    project: async (entry, document) => {
      calls.push(entry);
      const project = projections[entry];
      if (project === undefined) throw new Error(`the fixture has no projection ${entry}`);
      return project(document);
    },
  };
  return { ...base, ...overrides };
}

/** The payload inside an envelope file, without going through the store. */
async function payloadOf(file: string): Promise<Uint8Array> {
  const whole = new Uint8Array(await readFile(file));
  const view = new DataView(whole.buffer, whole.byteOffset, whole.byteLength);
  const headerLength = view.getUint32(10);
  return whole.subarray(14 + headerLength);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-desk-migrations-"));
  store = new DocumentStore(root);
  calls = [];

  const path = fileURLToPath(new URL("./fixtures/migration-pack/manifest.json", import.meta.url));
  const parsed = parsePackManifest(JSON.parse(await readFile(path, "utf8")));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("the fixture manifest is not a pack manifest");
  const declared = parsed.value.documents?.[0];
  if (declared === undefined) throw new Error("the fixture manifest declares no document");
  declaration = declared;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const scope = { containerId: "default", packId: "migration-sample" };

/** A schema-1 note, with a field the host has never heard of. */
async function oldNote(): Promise<Uint8Array> {
  const payload = encode({ title: "A note", packOnly: { nested: [1, 2, 3] } });
  await store.create(scope.containerId, scope.packId, "note");
  await store.save(scope.containerId, scope.packId, "note", payload);
  return payload;
}

describe("declared documents", () => {
  // spec: S6.3
  it("finds the declared document and runs its two-step migration", async () => {
    expect(declaration).toMatchObject({
      id: "note",
      format: "suite.note",
      version: 3,
      mode: "single",
      projection: "project.html",
    });
    expect(declaration.migrations?.map((step) => step.entry)).toEqual([
      "migrate-1-2.html",
      "migrate-2-3.html",
    ]);

    await oldNote();
    const result = await new DocumentMigrations(store).migrate(
      scope,
      [declaration],
      "note",
      runner(),
    );

    expect(result).toEqual({
      documentId: "note",
      from: 1,
      to: 3,
      steps: [
        { from: 1, to: 2, entry: "migrate-1-2.html" },
        { from: 2, to: 3, entry: "migrate-2-3.html" },
      ],
    });
    expect(calls).toEqual(["migrate-1-2.html 1->2", "migrate-2-3.html 2->3"]);

    expect(await store.header(scope.containerId, scope.packId, "note")).toMatchObject({
      schemaVersion: 3,
    });
    const opened = await store.open(scope.containerId, scope.packId, "note", { schemaVersion: 3 });
    expect(decode(opened?.bytes ?? new Uint8Array())).toEqual({
      title: "A note",
      packOnly: { nested: [1, 2, 3] },
      body: "",
      tags: [],
      migratedThrough: 3,
    });
  });

  // spec: S6.3
  it("stamps the schema without touching the payload when the entry only validates", async () => {
    const payload = await oldNote();
    const validateOnly: PackDocument = {
      id: declaration.id,
      format: declaration.format,
      version: 2,
      migrations: [{ from: 1, to: 2, entry: "validate-only.html" }],
    };

    await new DocumentMigrations(store).migrate(
      scope,
      [validateOnly],
      "note",
      runner({ migrate: async () => undefined }),
    );

    expect(await store.header(scope.containerId, scope.packId, "note")).toMatchObject({
      schemaVersion: 2,
      payloadLength: payload.byteLength,
    });
    // The host changed the header and copied the bytes; it did not parse them.
    expect(await payloadOf(join(root, "default", "migration-sample", "note"))).toEqual(payload);
  });

  // spec: S6.3
  it("invokes the declared projection with a read-only handle", async () => {
    await oldNote();
    const host = new DocumentMigrations(store);
    await host.migrate(scope, [declaration], "note", runner());
    calls = [];

    const projected = await host.project(scope, [declaration], "note", runner());
    expect(calls).toEqual(["project.html"]);
    expect(decode(projected)).toEqual({ title: "A note", tags: [] });
    // The projection is a read: the document is still at its migrated bytes.
    expect(await store.header(scope.containerId, scope.packId, "note")).toMatchObject({
      schemaVersion: 3,
    });
  });

  // spec: S6.3
  it("runs a lone multi declaration for a file whose name differs from its id", async () => {
    const multi: PackDocument = {
      id: "workspace",
      format: declaration.format,
      version: declaration.version,
      mode: "multi",
      ...(declaration.migrations === undefined ? {} : { migrations: declaration.migrations }),
      ...(declaration.projection === undefined ? {} : { projection: declaration.projection }),
    };
    await oldNote();
    const host = new DocumentMigrations(store);

    const migrated = await host.migrate(scope, [multi], "note", runner());
    expect(migrated.to).toBe(3);

    const projected = await host.project(scope, [multi], "note", runner());
    expect(decode(projected)).toEqual({ title: "A note", tags: [] });
  });

  // spec: S6.3
  it("refuses an undeclared document and a chain with a gap before writing", async () => {
    const payload = await oldNote();
    const host = new DocumentMigrations(store);

    const undeclared = await host.migrate(scope, [], "note", runner()).catch((error) => error);
    expect(undeclared).toBeInstanceOf(DocumentEntryError);
    expect((undeclared as DocumentEntryError).kind).toBe("undeclared");

    const gap: PackDocument = {
      id: declaration.id,
      format: declaration.format,
      version: 3,
      migrations: [{ from: 2, to: 3, entry: "migrate-2-3.html" }],
    };
    const refused = await host.migrate(scope, [gap], "note", runner()).catch((error) => error);
    expect(refused).toBeInstanceOf(DocumentEntryError);
    expect((refused as DocumentEntryError).kind).toBe("invalid-declaration");
    expect((refused as DocumentEntryError).message).toContain("no migration from schema 1");

    expect(calls).toEqual([]);
    expect(await payloadOf(join(root, "default", "migration-sample", "note"))).toEqual(payload);
    expect(await store.header(scope.containerId, scope.packId, "note")).toMatchObject({
      schemaVersion: 1,
    });
  });
});

describe("migration safety", () => {
  // spec: S6.6
  it("running the two-step migration twice leaves the document unchanged", async () => {
    await oldNote();
    const host = new DocumentMigrations(store);
    const first = await host.migrate(scope, [declaration], "note", runner());
    expect(first.steps).toHaveLength(2);

    const bytes =
      (await store.open(scope.containerId, scope.packId, "note", { schemaVersion: 3 }))?.bytes ??
      new Uint8Array();
    const header = await store.header(scope.containerId, scope.packId, "note");
    calls = [];

    const second = await host.migrate(scope, [declaration], "note", runner());

    expect(second).toEqual({ documentId: "note", from: 3, to: 3, steps: [] });
    expect(calls).toEqual([]);
    expect(
      (await store.open(scope.containerId, scope.packId, "note", { schemaVersion: 3 }))?.bytes,
    ).toEqual(bytes);
    expect(await store.header(scope.containerId, scope.packId, "note")).toEqual(header);
  });

  // spec: S6.6
  it("keeps the pre-migration backup and puts it back when an entry fails", async () => {
    const original = await oldNote();
    const host = new DocumentMigrations(store);
    const failing = runner({
      migrate: async (entry, document) => {
        calls.push(entry);
        if (entry === "migrate-2-3.html") throw new Error("the note cannot be reshaped");
        const migrate = migrations[entry];
        if (migrate === undefined) throw new Error(`the fixture has no migration ${entry}`);
        await migrate(document);
      },
    });

    const refusal = await host
      .migrate(scope, [declaration], "note", failing)
      .catch((error) => error);
    expect(refusal).toBeInstanceOf(DocumentEntryError);
    expect((refusal as DocumentEntryError).kind).toBe("failed");
    expect((refusal as DocumentEntryError).message).toContain("put back at schema 1");
    expect(calls).toEqual(["migrate-1-2.html", "migrate-2-3.html"]);

    // The old document is readable again at its old schema, payload untouched.
    expect(await store.header(scope.containerId, scope.packId, "note")).toMatchObject({
      schemaVersion: 1,
    });
    expect((await store.open(scope.containerId, scope.packId, "note"))?.bytes).toEqual(original);
    // The backup is the whole document the person had, not the first migrated step.
    expect(await payloadOf(join(root, "default", "migration-sample", "note.bak"))).toEqual(
      original,
    );
  });

  // spec: S6.6
  it("refuses a projection before the schema is current", async () => {
    const original = await oldNote();
    const host = new DocumentMigrations(store);
    const refusal = await host
      .project(scope, [declaration], "note", runner())
      .catch((error) => error);

    expect(refusal).toBeInstanceOf(DocumentEntryError);
    expect((refusal as DocumentEntryError).kind).toBe("not-current");
    expect((refusal as DocumentEntryError).message).toContain("migrate it to 3");
    expect(calls).toEqual([]);
    expect((await store.open(scope.containerId, scope.packId, "note"))?.bytes).toEqual(original);
  });
});
