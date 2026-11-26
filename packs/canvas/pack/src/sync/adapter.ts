import type { FileHandle, FilesService, RelayService } from "@suite/pack-runtime";
import type { RelayWebSocketFactory } from "@suite/sync";

import { packStoreFiles } from "./files.js";
import { createPackSyncService, type PackSyncService } from "./service.js";

/**
 * The sync doors the renderer already calls, over this pack's own service.
 *
 * The renderer was written against an Electron preload: `syncStatus`, `syncEnable`, `syncJoin`
 * and a handful of pushes. A pack is another host, not another app mode, so this adapter
 * implements that same seam over the host's relay service and the pack's files. The dialog,
 * the title pill and the store are untouched.
 *
 * Every call is scoped to the workspace that is open now. A pack has one document per page,
 * and a reload is the only way that changes, so the service is made lazily and replaced when
 * the id changes. No key, contact or relay pin is kept in `localStorage`: the shared stores
 * write them through `files`.
 */

export interface PackSyncInfo {
  readonly workspaceId: string | null;
  readonly deviceId: string;
  readonly status:
    | { readonly state: "off" }
    | { readonly state: "connecting" }
    | { readonly state: "syncing"; readonly count: number }
    | { readonly state: "asleep"; readonly reason: string }
    | { readonly state: "refused"; readonly reason: string }
    | { readonly state: "waiting" }
    | { readonly state: "removed" };
  readonly members: readonly {
    readonly deviceId: string;
    readonly name: string;
    readonly role: "owner" | "editor" | "viewer";
  }[];
  readonly friendCode: string;
  readonly friendLink?: string | undefined;
  readonly contacts: readonly {
    readonly code: string;
    readonly name: string;
    readonly deviceId?: string | undefined;
    readonly publicKey?: string | undefined;
    readonly addedAt: string;
    readonly lastSeenAt?: string | undefined;
    readonly trusted: boolean;
  }[];
  readonly fingerprint?: string | null | undefined;
  readonly relayUrl?: string | null | undefined;
  readonly kit?: "made" | "declined" | null | undefined;
  readonly sinceOpened?: {
    readonly openedAt: string;
    readonly updates: number;
    readonly lastSyncedAt: string | null;
  } | null | undefined;
  readonly problem?: string | undefined;
}

export type PackKitImportResult =
  | { readonly ok: true; readonly status: PackSyncInfo }
  | { readonly ok: false; readonly reason: "cancelled" }
  | { readonly ok: false; readonly reason: "passphrase"; readonly path: string }
  | { readonly ok: false; readonly reason: "message"; readonly message: string };

export interface PackSyncAdapterOptions {
  /** The pack's own root. Absent when the host did not grant `files`. */
  readonly files: FilesService | undefined;
  /** The host's relay service. Absent when it did not grant `relay`. */
  readonly relay: RelayService | undefined;
  /** The workspace this page has open, or null on the launcher. */
  readonly workspaceId: () => string | null;
  readonly deviceName?: string;
  /** Test seam: a socket the suite drives instead of the host relay. */
  readonly webSocket?: RelayWebSocketFactory;
  readonly now?: () => Date;
}

const HUB_UNKNOWN = { running: false, address: null, scope: "loopback" } as const;

export function createPackSyncAdapter(options: PackSyncAdapterOptions) {
  let service: PackSyncService | null = null;
  let serviceWorkspace: string | null = null;
  let serviceProblem: string | null = null;
  let openedAt = new Date().toISOString();
  let updates = 0;
  let lastSyncedAt: string | null = null;

  const incoming = new Set<(update: number[]) => void>();
  const changed = new Set<(info: PackSyncInfo) => void>();
  const snapshotWanted = new Set<() => void>();
  const presenceIncoming = new Set<(update: number[]) => void>();

  /** A handle the file picker already handed over, for the passphrase retry. */
  const kitHandles = new Map<string, FileHandle>();
  let kitTokens = 0;

  const off = (problem?: string): PackSyncInfo => ({
    workspaceId: options.workspaceId(),
    deviceId: "",
    status: { state: "off" },
    members: [],
    friendCode: "",
    contacts: [],
    fingerprint: null,
    relayUrl: null,
    kit: null,
    sinceOpened: null,
    ...(problem === undefined ? {} : { problem }),
  });

  async function info(
    current: PackSyncService | null,
    status?: PackSyncInfo["status"],
  ): Promise<PackSyncInfo> {
    if (current === null) return off(serviceProblem ?? undefined);
    const open = status ?? current.status();
    const persistedKit = await current.kit();
    return {
      workspaceId: serviceWorkspace,
      deviceId: current.identity().deviceId,
      status: open,
      members: current.members(),
      friendCode: current.friendCode(),
      friendLink: current.friendLink(),
      contacts: current.contacts(),
      fingerprint: current.relayFingerprint(),
      relayUrl: current.relayUrl(),
      kit: persistedKit,
      sinceOpened:
        lastSyncedAt === null ? null : { openedAt, updates, lastSyncedAt },
    } satisfies PackSyncInfo;
  }

  /** Tell every listener what changed, once, from one snapshot. */
  function announce(current: PackSyncService | null): void {
    void info(current).then((next) => {
      for (const listener of changed) listener(next);
    });
  }

  async function ensure(): Promise<PackSyncService | null> {
    const workspace = options.workspaceId();
    if (workspace === null) return null;
    if (service !== null && serviceWorkspace === workspace) return service;

    await service?.dispose();
    service = null;
    serviceWorkspace = workspace;
    serviceProblem = null;
    openedAt = new Date().toISOString();
    updates = 0;
    lastSyncedAt = null;

    if (options.files === undefined) {
      serviceProblem = "This host has no file service, so a sync key cannot be kept.";
      return null;
    }
    if (options.relay === undefined) {
      serviceProblem =
        "This host cannot open a relay connection, so sync is unavailable here.";
      return null;
    }

    const created = await createPackSyncService({
      files: packStoreFiles(options.files),
      workspaceId: workspace,
      relay: options.relay,
      deviceName: options.deviceName ?? "Suite Canvas",
      ...(options.webSocket === undefined ? {} : { webSocket: options.webSocket }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    created.onUpdate((update) => {
      updates += 1;
      for (const listener of incoming) listener(Array.from(update));
    });
    created.onStatus((status) => {
      if (status.state === "syncing") lastSyncedAt = new Date().toISOString();
      announce(created);
    });
    created.onMembers(() => announce(created));
    created.onJoinedByAnother(() => {
      for (const listener of snapshotWanted) listener();
    });
    created.onPresence((update) => {
      for (const listener of presenceIncoming) listener(Array.from(update));
    });
    // A join that was still waiting when the page closed picks itself up here.
    void created.resume();
    service = created;
    return created;
  }

  async function run(
    work: (current: PackSyncService) => Promise<PackSyncInfo["status"] | void>,
    problemOf: (error: unknown) => string,
  ): Promise<PackSyncInfo> {
    const current = await ensure();
    if (current === null) return off(serviceProblem ?? undefined);
    try {
      const status = await work(current);
      return await info(current, status === undefined ? undefined : status);
    } catch (error) {
      return { ...(await info(current)), problem: problemOf(error) };
    }
  }

  return {
    enabled: options.relay !== undefined,

    async status(): Promise<PackSyncInfo> {
      return info(await ensure());
    },

    async enable(url: string, fingerprint?: string): Promise<PackSyncInfo> {
      return run(
        (current) => current.connect(url, fingerprint),
        (error) => sentence(error, "Sync could not be started."),
      );
    },

    async disable(): Promise<PackSyncInfo> {
      return run(
        async (current) => {
          await current.disconnect();
        },
        (error) => sentence(error, "Sync could not be stopped."),
      );
    },

    async publish(update: number[]): Promise<void> {
      const current = await ensure();
      await current?.publish(Uint8Array.from(update));
    },

    async invite(role: "editor" | "viewer"): Promise<string | null> {
      const current = await ensure();
      if (current === null) return null;
      return current.createInvite(role);
    },

    async join(link: string, fingerprint?: string): Promise<PackSyncInfo> {
      return run(
        (current) => current.join(link, fingerprint),
        (error) => sentence(error, "That invitation could not be used."),
      );
    },

    async addContact(input: {
      code: string;
      name: string;
      publicKey?: string;
    }): Promise<PackSyncInfo> {
      return run(
        async (current) => {
          await current.addContact(
            input.publicKey === undefined
              ? { code: input.code, name: input.name }
              : { code: input.code, name: input.name, publicKey: input.publicKey },
          );
        },
        (error) => sentence(error, "That contact could not be added."),
      );
    },

    async removeContact(code: string): Promise<PackSyncInfo> {
      return run(
        async (current) => {
          await current.removeContact(code);
        },
        (error) => sentence(error, "That contact could not be removed."),
      );
    },

    async remove(deviceId: string): Promise<PackSyncInfo> {
      return run(
        async (current) => {
          await current.removeDevice(deviceId);
        },
        (error) => sentence(error, "That device could not be removed."),
      );
    },

    async presence(update: number[]): Promise<void> {
      const current = await ensure();
      await current?.presence(Uint8Array.from(update));
    },

    async exportKit(passphrase: string | null): Promise<string | null> {
      const current = await ensure();
      if (current === null) throw new Error(serviceProblem ?? "No workspace is open.");
      if (options.files?.pickSave === undefined) {
        throw new Error("This host has no save picker, so a recovery file cannot be written.");
      }
      const bytes = await current.exportKit(passphrase);
      const handle = await options.files.pickSave("suite-way-back-in.json");
      if (handle === null) return null;
      try {
        await handle.write(bytes);
      } finally {
        await handle.close();
      }
      await current.noteKit("made", (passphrase ?? "").trim().length > 0);
      announce(current);
      return handle.info.name;
    },

    async importKit(request: {
      path?: string;
      passphrase?: string;
    }): Promise<PackKitImportResult> {
      const files = options.files;
      if (files?.pickOpen === undefined) {
        return {
          ok: false,
          reason: "message",
          message: "This host has no file picker, so a recovery file cannot be opened.",
        };
      }
      const current = await ensure();
      if (current === null) {
        return { ok: false, reason: "message", message: serviceProblem ?? "No workspace is open." };
      }

      let token = typeof request.path === "string" ? request.path : null;
      let handle = token === null ? null : (kitHandles.get(token) ?? null);
      if (handle === null) {
        handle = await files.pickOpen();
        if (handle === null) return { ok: false, reason: "cancelled" };
        token = `pack-kit-${(kitTokens += 1)}`;
        kitHandles.set(token, handle);
      }

      try {
        const bytes = await handle.read();
        await current.importKit(bytes, request.passphrase ?? null);
      } catch (error) {
        const message = sentence(error, "That file could not be opened.");
        if (/passphrase/iu.test(message) && token !== null) {
          // Keep the handle: the next call is the same file with the word that opens it.
          return { ok: false, reason: "passphrase", path: token };
        }
        kitHandles.delete(token ?? "");
        await handle.close();
        return { ok: false, reason: "message", message };
      }

      kitHandles.delete(token ?? "");
      await handle.close();
      return { ok: true, status: await info(current) };
    },

    async declineKit(): Promise<void> {
      const current = await ensure();
      if (current === null) return;
      await current.noteKit("declined", false);
      announce(current);
    },

    async hub(): Promise<typeof HUB_UNKNOWN | null> {
      // A pack receives frames, not the host's tray: the address and pin are typed or pasted
      // from what Suite Desk shows. Saying "not running" would be a claim this side cannot make.
      return HUB_UNKNOWN;
    },

    /** The pushes the renderer's store subscribes to. */
    onIncoming(listener: (update: number[]) => void): void {
      incoming.add(listener);
    },
    onChanged(listener: (info: PackSyncInfo) => void): void {
      changed.add(listener);
    },
    onSnapshotWanted(listener: () => void): void {
      snapshotWanted.add(listener);
    },
    onPresence(listener: (update: number[]) => void): void {
      presenceIncoming.add(listener);
    },

    async dispose(): Promise<void> {
      await service?.dispose();
      service = null;
      serviceWorkspace = null;
      for (const handle of kitHandles.values()) await handle.close();
      kitHandles.clear();
    },
  };
}

export type PackSyncAdapter = ReturnType<typeof createPackSyncAdapter>;

/**
 * The names the renderer already calls, bound to this adapter.
 *
 * A pack that did not declare `relay` shows none of these, which is what makes the title pill
 * say local rather than offering a door the host would refuse.
 */
export function packSyncBridge(adapter: PackSyncAdapter) {
  return {
    syncStatus: () => adapter.status(),
    syncEnable: (url: string, fingerprint?: string) => adapter.enable(url, fingerprint),
    syncDisable: () => adapter.disable(),
    syncPublish: (update: number[]) => adapter.publish(update),
    syncInvite: (role: "editor" | "viewer") => adapter.invite(role),
    syncJoin: (link: string, fingerprint?: string) => adapter.join(link, fingerprint),
    syncAddContact: (input: { code: string; name: string; publicKey?: string }) =>
      adapter.addContact(input),
    syncRemoveContact: (code: string) => adapter.removeContact(code),
    onSyncIncoming: (listener: (update: number[]) => void) => adapter.onIncoming(listener),
    onSyncChanged: (listener: (info: PackSyncInfo) => void) => adapter.onChanged(listener),
    onSyncSnapshotWanted: (listener: () => void) => adapter.onSnapshotWanted(listener),
    syncPresence: (update: number[]) => adapter.presence(update),
    onSyncPresence: (listener: (update: number[]) => void) => adapter.onPresence(listener),
    syncRemove: (deviceId: string) => adapter.remove(deviceId),
    syncExportKit: (passphrase: string | null) => adapter.exportKit(passphrase),
    syncImportKit: (request: { path?: string; passphrase?: string }) => adapter.importKit(request),
    syncDeclineKit: () => adapter.declineKit(),
    syncHub: () => adapter.hub(),
  };
}

function sentence(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
