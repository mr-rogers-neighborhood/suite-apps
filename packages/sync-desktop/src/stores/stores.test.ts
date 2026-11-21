import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDeviceIdentity,
  createWorkspaceGroup,
  deriveFriendCode,
  encodeBase64,
  encodeKeyPackageBytes,
} from "@suite/sync";
import { afterEach, describe, expect, it } from "vitest";

import { createSyncStores } from "./index.js";

const workspaceId = "a".repeat(64);
const cleanups: string[] = [];

async function folder(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "suite-sync-stores-"));
  cleanups.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function storesFor(dataDir: string) {
  return createSyncStores({ dataDir, workspaceId });
}

describe("the shared desktop stores", () => {
  it("round-trips a group, a relay pin, a cursor and a pending join", async () => {
    const dataDir = await folder();
    const stores = storesFor(dataDir);

    const group = await createWorkspaceGroup(
      workspaceId,
      await createDeviceIdentity("this laptop"),
    );
    await stores.group.save(group);
    const loadedGroup = await stores.group.load();
    expect(loadedGroup?.epoch).toBe(group.epoch);
    expect(await stores.group.isOwned()).toBe(false);
    await stores.group.markOwned();
    expect(await stores.group.isOwned()).toBe(true);

    expect(await stores.relay.load()).toBeNull();
    await stores.relay.save({ host: "ws://127.0.0.1:8787/sync", fingerprint: null });
    expect(await stores.relay.load()).toEqual({
      host: "ws://127.0.0.1:8787/sync",
      fingerprint: null,
    });

    expect(await stores.cursor.load()).toBeNull();
    await stores.cursor.save(7);
    expect(await stores.cursor.load()).toBe(7);
    await stores.cursor.clear();
    expect(await stores.cursor.load()).toBeNull();

    const asked = await createDeviceIdentity("joining device");
    expect(await stores.pending.load()).toBeNull();
    await stores.pending.save(asked, "ws://127.0.0.1:8787/sync");
    const pending = await stores.pending.load();
    expect(pending?.host).toBe("ws://127.0.0.1:8787/sync");
    expect(pending?.identity.name).toBe("joining device");
    expect(encodeBase64(encodeKeyPackageBytes(pending?.identity.keyPackage as Uint8Array))).toBe(
      encodeBase64(encodeKeyPackageBytes(asked.keyPackage)),
    );
    await stores.pending.clear();
    expect(await stores.pending.load()).toBeNull();
  });

  it("round-trips contacts, including forget", async () => {
    const dataDir = await folder();
    const stores = storesFor(dataDir);

    const { publicKey } = generateKeyPairSync("ed25519");
    const encoded = publicKey
      .export({ format: "der", type: "spki" })
      .subarray(12)
      .toString("base64");
    const added = await stores.contacts.remember([], {
      code: deriveFriendCode(encoded),
      name: "Sam",
      publicKey: encoded,
    });
    expect(added).toHaveLength(1);
    expect(await stores.contacts.load()).toHaveLength(1);

    const forgotten = await stores.contacts.forget(added, added[0]?.code ?? "");
    expect(forgotten).toEqual([]);
    expect(await stores.contacts.load()).toEqual([]);
  });

  it("treats a corrupt or unreadable file as empty rather than crashing", async () => {
    const dataDir = await folder();
    const stores = storesFor(dataDir);
    const sync = join(dataDir, "sync");
    await mkdir(join(sync, "groups"), { recursive: true });
    await mkdir(join(sync, "cursors"), { recursive: true });
    await mkdir(join(sync, "relays"), { recursive: true });
    await mkdir(join(sync, "pending"), { recursive: true });
    await writeFile(join(sync, "groups", `${workspaceId}.mls`), "not a group");
    await writeFile(join(sync, "cursors", `${workspaceId}.json`), "{");
    await writeFile(join(sync, "relays", `${workspaceId}.json`), '{"host":42}');
    await writeFile(join(sync, "pending", `${workspaceId}.json`), '{"private":{}}');
    await writeFile(join(sync, "contacts.json"), '{"version":1,"contacts":[{"code":"nope"}]}');

    expect(await stores.group.load()).toBeNull();
    expect(await stores.cursor.load()).toBeNull();
    expect(await stores.relay.load()).toBeNull();
    expect(await stores.pending.load()).toBeNull();
    expect(await stores.contacts.load()).toEqual([]);
  });

  it("writes through a temporary file and leaves no half-written target", async () => {
    const dataDir = await folder();
    const stores = storesFor(dataDir);
    const cursorDirectory = join(dataDir, "sync", "cursors");

    await stores.cursor.save(1);
    await stores.cursor.save(2);

    expect(await stores.cursor.load()).toBe(2);
    expect(await readdir(cursorDirectory)).toEqual([`${workspaceId}.json`]);
    const written = await stat(join(cursorDirectory, `${workspaceId}.json`));
    expect(written.mode & 0o777).toBe(0o600);
    expect(await readFile(join(cursorDirectory, `${workspaceId}.json`), "utf8")).toContain(
      '"index":2',
    );
  });
});
