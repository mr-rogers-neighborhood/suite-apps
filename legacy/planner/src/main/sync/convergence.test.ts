import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSyncServer,
  ed25519Verifier,
  FileHostStore,
  HostRegistry,
  type SyncServer,
} from "@suite/host";
import { WorkspaceDocument } from "@suite/planner-core";
import { afterEach, describe, expect, it } from "vitest";

import { createPlannerSyncService, type PlannerSyncService } from "./service";
import { toSyncWorkspaceId } from "./workspaceId";

/**
 * Two Planner profiles, one real relay.
 *
 * The relay is the same `@suite/host` server Start runs, bound to loopback on a port the
 * operating system picks. The documents are real `WorkspaceDocument`s, the frames are real
 * MLS application messages, and the store is the file store the relay ships — so this
 * covers the path a person would take, not a mock of it.
 *
 * The blind half follows `services/relay/packages/host/src/store.test.ts`: after the edits are
 * relayed, the bytes on the relay's disk must not contain either title. It is the same
 * assertion the relay's own store test makes, pointed at Planner's frames.
 */

const cleanups: string[] = [];
const services: PlannerSyncService[] = [];
const servers: SyncServer[] = [];

async function folder(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(directory);
  return directory;
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function service(options: Parameters<typeof createPlannerSyncService>[0]) {
  const created = await createPlannerSyncService(options);
  services.push(created);
  return created;
}

/** The updates a workspace's own edit produced, the same deltas a renderer sends over IPC. */
function capture(document: WorkspaceDocument, edit: () => void): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const stop = document.observe((update) => updates.push(update));
  edit();
  stop();
  return updates;
}

function titles(document: WorkspaceDocument): string[] {
  return document
    .listTasks()
    .map((task) => task.title)
    .sort();
}

afterEach(async () => {
  await Promise.all(
    services.splice(0).map((created) => created.disconnect().catch(() => undefined)),
  );
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    cleanups.splice(0).map((directory) =>
      // A cursor write can land just after disconnect, while the directory is
      // being removed. Retrying the removal is the honest fix: the test is about
      // convergence, not about which teardown wins the filesystem race.
      rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  );
});

describe("two Planner profiles through a real relay", () => {
  it("converges on one document and leaves only ciphertext at the relay", async () => {
    const relayDir = await folder("suite-planner-relay-");
    const registry = new HostRegistry();
    const server = await createSyncServer({
      registry,
      port: 0,
      store: new FileHostStore(relayDir),
      verifyFrame: ed25519Verifier,
      verifyRole: ed25519Verifier,
    });
    servers.push(server);

    // The same workspace, copied the way the demo says: the id is in the file, so both
    // profiles name the same relay room without a schema change.
    const first = WorkspaceDocument.create();
    first.createTask({ title: "A task that was there before sharing" });
    const aliceDocument = WorkspaceDocument.fromSnapshot(first.snapshot());
    const bobDocument = WorkspaceDocument.fromSnapshot(first.snapshot());
    const workspaceId = toSyncWorkspaceId(aliceDocument.getMeta().workspaceId);

    const alice = await service({
      dataDir: await folder("suite-planner-alice-"),
      workspaceId,
      deviceName: "Planner on alice",
      reconnectDelayMs: 50,
    });
    const bobDir = await folder("suite-planner-bob-");
    const bob = await service({
      dataDir: bobDir,
      workspaceId,
      deviceName: "Planner on bob",
      reconnectDelayMs: 50,
    });

    alice.onUpdate((update) => aliceDocument.applyUpdate(update));
    bob.onUpdate((update) => bobDocument.applyUpdate(update));
    // A device that joins cannot read what was sealed before it arrived; the snapshot is
    // how it gets the workspace. A reconnect uses the same door for edits made offline.
    alice.onJoinedByAnother(() => void alice.publish(aliceDocument.snapshot()));
    bob.onJoinedByAnother(() => void bob.publish(bobDocument.snapshot()));
    alice.onConnected(() => void alice.publish(aliceDocument.snapshot()));
    bob.onConnected(() => void bob.publish(bobDocument.snapshot()));

    // Share: this is where the group and the ownership claim are made.
    await alice.connect(server.url);
    await waitFor(
      () => alice.members().some((member) => member.role === "owner"),
      "the owner record",
    );

    const invitation = await alice.createInvite("editor");
    await waitFor(
      () => Object.keys(registry.get(workspaceId)?.invites.invites ?? {}).length > 0,
      "the relay to keep the invitation",
    );

    // A signed invitation is recognised through a contact, so Bob adds Alice's code first.
    // That is the explicit act the friend-code design asks for; an unknown code is refused.
    await bob.addContact({ code: alice.friendCode(), name: "Planner on Alice" });

    // Join: the invitation is a bearer token, the relay spends it, Alice admits the key
    // package, and Bob takes the welcome that follows.
    await bob.join(invitation);
    await waitFor(() => bob.status().state === "syncing", "bob to be let in");
    await waitFor(() => alice.members().length === 2 && bob.members().length === 2, "both rosters");

    // An edit on either side reaches the other, in both directions.
    let aliceTaskId = "";
    for (const update of capture(aliceDocument, () => {
      aliceTaskId = aliceDocument.createTask({ title: "Q4 planning" }).id;
    })) {
      await alice.publish(update);
    }
    await waitFor(
      () => bobDocument.listTasks().some((task) => task.title === "Q4 planning"),
      "alice's task at bob",
    );

    for (const update of capture(bobDocument, () => {
      bobDocument.createTask({ title: "Talk to the printer" });
    })) {
      await bob.publish(update);
    }
    await waitFor(
      () => aliceDocument.listTasks().some((task) => task.title === "Talk to the printer"),
      "bob's task at alice",
    );

    expect(titles(aliceDocument)).toEqual(titles(bobDocument));
    expect(titles(aliceDocument)).toContain("A task that was there before sharing");

    // The relay's own store, read as an operator would read it.
    const onDisk = await readFile(join(relayDir, `${workspaceId}.frames.jsonl`), "utf8");
    expect(onDisk).not.toContain("Q4 planning");
    expect(onDisk).not.toContain("Talk to the printer");
    expect(onDisk).not.toContain("A task that was there before sharing");
    expect(onDisk).toContain(workspaceId);
    expect(onDisk).toContain('"kind":"application"');

    // Bob goes away, Alice keeps working, and Bob catches up when he comes back: the cursor
    // is the relay's numbering, so he asks for exactly what he missed.
    await bob.disconnect();
    const revised = capture(aliceDocument, () => {
      aliceDocument.updateTask(aliceTaskId, { title: "Q4 planning, revised" });
    });
    for (const update of revised) await alice.publish(update);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bobDocument.getTask(aliceTaskId)?.title).toBe("Q4 planning");

    await bob.connect(server.url);
    await waitFor(
      () => bobDocument.getTask(aliceTaskId)?.title === "Q4 planning, revised",
      "bob to catch up",
    );
    expect(titles(aliceDocument)).toEqual(titles(bobDocument));
  }, 30_000);
});
