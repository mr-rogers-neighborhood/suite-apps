import type { SyncInfo, SyncState } from "@suite/planner-core";
import type { NewContact } from "@suite/sync";
import type { WebContents } from "electron";

import type { WorkspaceStore } from "../workspaceStore";
import { createPlannerSyncService, type PlannerSyncService } from "./service";
import { toSyncWorkspaceId } from "./workspaceId";

/**
 * The sync service as the renderer sees it.
 *
 * The service belongs to the workspace that is open. Opening another file replaces the
 * authority, so this controller tears the old connection down and builds the next one
 * against the new workspace's derived id. Nothing here reads or writes the document except
 * through `WorkspaceStore`, which is what keeps one owner for document truth.
 */
export interface PlannerSyncController {
  status(): Promise<SyncInfo>;
  enable(url: string, fingerprint?: string): Promise<SyncInfo>;
  disable(): Promise<SyncInfo>;
  invite(role: "editor" | "viewer", to?: string): Promise<string | null>;
  join(link: string, fingerprint?: string): Promise<SyncInfo>;
  addContact(input: NewContact): Promise<SyncInfo>;
  removeContact(code: string): Promise<SyncInfo>;
  /** A local commit the renderer sent. Never creates a connection. */
  publish(update: Uint8Array): void;
  /** The workspace behind the controller changed: drop the old connection. */
  workspaceChanged(): Promise<void>;
  stop(): Promise<void>;
}

export interface PlannerSyncControllerOptions {
  readonly getStore: () => WorkspaceStore | null;
  readonly webContents: () => WebContents | null;
  /** The app hands a snapshot to every window after a frame changes the authority. */
  readonly publishReplaced: (snapshot: Uint8Array) => void;
  readonly deviceName: string;
}

const CHANNEL = "sync:changed";

export function createPlannerSyncController(
  options: PlannerSyncControllerOptions,
): PlannerSyncController {
  let service: PlannerSyncService | null = null;
  let boundStore: WorkspaceStore | null = null;
  let boundWorkspaceId: string | null = null;
  let deviceId = "";

  const off: SyncState = { state: "off" };

  function info(status: SyncState = service?.status() ?? off): SyncInfo {
    return {
      workspaceId: boundWorkspaceId,
      deviceId,
      status,
      members: service?.members() ?? [],
      friendCode: service?.friendCode() ?? "",
      friendLink: service?.friendLink() ?? "",
      contacts: (service?.contacts() ?? []).map((contact) => ({
        code: contact.code,
        name: contact.name,
        addedAt: contact.addedAt,
        trusted: contact.trusted,
        ...(contact.deviceId !== undefined ? { deviceId: contact.deviceId } : {}),
        ...(contact.publicKey !== undefined ? { publicKey: contact.publicKey } : {}),
        ...(contact.lastSeenAt !== undefined ? { lastSeenAt: contact.lastSeenAt } : {}),
      })),
    };
  }

  function announce(next: SyncState = service?.status() ?? off): void {
    options.webContents()?.send(CHANNEL, info(next));
  }

  async function teardown(): Promise<void> {
    const previous = service;
    service = null;
    boundStore = null;
    boundWorkspaceId = null;
    deviceId = "";
    await previous?.disconnect();
  }

  async function ensureService(): Promise<PlannerSyncService | null> {
    const store = options.getStore();
    if (store === null) return null;

    const workspaceId = toSyncWorkspaceId(store.document.getMeta().workspaceId);
    if (service !== null && boundStore === store && boundWorkspaceId === workspaceId)
      return service;

    await teardown();
    boundStore = store;
    boundWorkspaceId = workspaceId;

    const created = await createPlannerSyncService({
      dataDir: store.directory,
      workspaceId,
      deviceName: options.deviceName,
    });
    service = created;
    deviceId = (await created.identity()).deviceId;

    created.onUpdate((update) => {
      if (service !== created || options.getStore() !== store) return;
      // The authority may have been replaced by an import between the frame leaving the
      // relay and arriving here. A frame for the old workspace must not touch the new one.
      if (toSyncWorkspaceId(store.document.getMeta().workspaceId) !== boundWorkspaceId) return;
      // The same boundary a local edit crosses: import, then the ordinary debounced write.
      store.commit(update);
      options.publishReplaced(store.snapshot());
    });
    created.onStatus((next) => {
      if (service !== created) return;
      announce(next);
    });
    // A device arriving does not change what sync is doing, but it does change who a person
    // sees when they open the dialog.
    created.onMembers(() => {
      if (service !== created) return;
      announce();
    });
    // Somebody was let in, and this copy may hold edits sealed before they arrived.
    const handOver = (): void => {
      if (service !== created || options.getStore() !== store) return;
      if (toSyncWorkspaceId(store.document.getMeta().workspaceId) !== boundWorkspaceId) return;
      void created.publish(store.snapshot());
    };
    created.onJoinedByAnother(handOver);
    created.onConnected(handOver);

    // A join that was still waiting when the app closed picks itself up here.
    void created.resume();
    return created;
  }

  return {
    async status() {
      const current = await ensureService();
      return info(current?.status() ?? off);
    },

    async enable(url, fingerprint) {
      const current = await ensureService();
      if (current === null) return info(off);
      return info(await current.connect(url, fingerprint));
    },

    async disable() {
      const current = service;
      if (current !== null) await current.disconnect();
      return info(off);
    },

    async invite(role: "editor" | "viewer", to?: string) {
      const current = await ensureService();
      if (current === null) return null;
      return current.createInvite(role, to);
    },

    async join(link, fingerprint) {
      const current = await ensureService();
      if (current === null) return info(off);
      return info(await current.join(link, fingerprint));
    },

    async addContact(input) {
      const current = await ensureService();
      if (current === null) return info(off);
      await current.addContact(input);
      announce();
      return info();
    },

    async removeContact(code) {
      const current = await ensureService();
      if (current === null) return info(off);
      await current.removeContact(code);
      announce();
      return info();
    },

    publish(update) {
      const current = service;
      if (current === null) return;
      // Publishing is ordered behind any frame being applied; a seal must not race a commit.
      void current.publish(update).catch((error: unknown) => {
        console.warn("Suite Planner: could not publish an edit", error);
      });
    },

    async workspaceChanged() {
      await teardown();
      announce(off);
    },

    async stop() {
      await teardown();
    },
  };
}
