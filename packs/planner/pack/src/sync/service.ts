import type { FilesService, RelayService } from "@suite/pack-runtime";
import type { SyncInfo, SyncState } from "@suite/planner-core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  deriveFriendCode,
  type FriendInvite,
  type FriendInviteBody,
  type FriendInviteRejection,
  formatFriendCode,
  formatFriendLink,
  formatInvite,
  friendInvitePayload,
  isLoopbackRelayUrl,
  type InviteRecord,
  inviteRecordPayload,
  type NewContact,
  normaliseFingerprint,
  parseFriendCode,
  parseInvite,
  resolveFriendInvite,
  type SyncContact,
  verifyFriendInvite,
} from "@suite/sync";
import {
  createSyncLifecycle,
  type SyncLifecycle,
  type SyncStores,
  type SyncStatus,
} from "@suite/sync-desktop";

import { loadOrCreateIdentity, type PackSyncIdentity, verifyEd25519 } from "./identity";
import { requireSyncFiles, createPackSyncStores } from "./stores";
import { createHostRelayWebSocketFactory } from "./transport";

/**
 * Planner's sync, in the pack.
 *
 * The document authority is the pack, so the keys and the sealed frames are too.
 * The host supplies one narrow service: open a socket to the relay it supervises
 * and move opaque bytes. It never sees a frame's plaintext, a workspace id or a
 * path. Every key, contact, group, cursor and pending join is a file in the
 * pack's own scoped root, not browser storage.
 *
 * The mechanics are `@suite/sync-desktop`'s: the group, relay pin, cursor,
 * pending join, ordered frame queue and reconnect policy are the same ones the
 * frozen desktop shell uses. This file is the seam that gives them a renderer
 * identity (WebCrypto-adjacent noble keys), a pack-side store, and the host's
 * relay transport.
 */

const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A legacy link carries no signature, so only a loopback demo may still use one. */
const LEGACY_REMOTE_MESSAGE =
  "That is an old invitation without a signature. Ask for a new signed invitation.";

export interface PlannerSyncHost {
  readonly relay?: RelayService | undefined;
  readonly files?: Partial<FilesService> | undefined;
  readonly info?: (() => Promise<{ readonly platform?: string | undefined }>) | undefined;
}

export interface PlannerSyncOptions {
  readonly host: PlannerSyncHost;
  /** The open workspace's own id. The service hashes it into the protocol's id. */
  readonly workspace: () => Promise<string | null>;
  /** Apply one opened update to the local document authority. */
  readonly onDocumentUpdate: (update: Uint8Array) => void | Promise<void>;
  /** The current snapshot to hand a new or reconnecting device. */
  readonly onDocumentSnapshot: () => Uint8Array | null;
  /** Status or membership changed; the bridge pushes a new `SyncInfo`. */
  readonly onChange?: (() => void) | undefined;
  /** Tests pin the clock; production uses the wall clock. */
  readonly now?: (() => Date) | undefined;
}

export interface PlannerSync {
  info(): Promise<SyncInfo>;
  enable(url: string, fingerprint?: string): Promise<SyncInfo>;
  disable(): Promise<SyncInfo>;
  invite(role: "editor" | "viewer", to?: string): Promise<string | null>;
  join(link: string, fingerprint?: string): Promise<SyncInfo>;
  addContact(input: NewContact): Promise<SyncInfo>;
  removeContact(code: string): Promise<SyncInfo>;
  /** Hand one local document update to the shared lifecycle. Never a path or a key. */
  publish(update: Uint8Array): void;
  /** The open workspace was replaced; the next call builds against its id. */
  workspaceChanged(): Promise<void>;
  dispose(): Promise<void>;
}

interface Runtime {
  readonly plannerWorkspaceId: string;
  readonly workspaceId: string;
  readonly identity: PackSyncIdentity;
  readonly stores: SyncStores;
  readonly lifecycle: SyncLifecycle;
  contacts: readonly SyncContact[];
}

function toSyncWorkspaceId(plannerWorkspaceId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`suite-planner/workspace\n${plannerWorkspaceId}`)));
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

function friendly(status: SyncStatus): SyncState {
  return status;
}

function emptyInfo(status: SyncState = { state: "off" }): SyncInfo {
  return {
    workspaceId: null,
    deviceId: "",
    status,
    members: [],
    friendCode: "",
    friendLink: "",
    contacts: [],
  };
}

function friendRejection(reason: FriendInviteRejection): string {
  switch (reason) {
    case "expired":
      return "That invitation has expired. Ask for a fresh one.";
    case "unpinned-relay":
      return "That invitation does not pin its relay certificate.";
    case "device-key-mismatch":
      return "That invitation's device id does not match its key.";
    case "invalid-signature":
      return "That invitation's signature is not valid. Ask for a fresh one.";
    case "malformed-key":
      return "That invitation does not carry a usable identity key.";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPlannerSync(options: PlannerSyncOptions): PlannerSync {
  const { host } = options;
  let runtime: Runtime | null = null;
  let opening: Promise<Runtime> | null = null;
  /** The certificate each relay URL must present, read by the transport at connect time. */
  const pins = new Map<string, string>();

  function rememberPin(url: string, fingerprint: string | undefined): void {
    if (fingerprint === undefined || fingerprint.trim() === "") {
      pins.delete(url);
      return;
    }
    pins.set(url, normaliseFingerprint(fingerprint) ?? fingerprint.trim());
  }

  async function deviceName(): Promise<string> {
    if (host.info === undefined) return "Planner";
    try {
      const platform = (await host.info()).platform;
      return typeof platform === "string" && platform.length > 0
        ? `Planner on ${platform}`
        : "Planner";
    } catch {
      return "Planner";
    }
  }

  async function closeRuntime(): Promise<void> {
    const previous = runtime;
    runtime = null;
    opening = null;
    if (previous !== null) await previous.lifecycle.disconnect().catch(() => undefined);
  }

  async function buildRuntime(): Promise<Runtime> {
    const plannerWorkspaceId = await options.workspace();
    if (plannerWorkspaceId === null) throw new Error("No workspace is open.");

    const files = requireSyncFiles(host.files);
    const identity = await loadOrCreateIdentity(files);
    const workspaceId = toSyncWorkspaceId(plannerWorkspaceId);
    const stores = createPackSyncStores({ files, workspaceId });
    const storedRelay = await stores.relay.load();
    if (storedRelay !== null && storedRelay.fingerprint !== null) {
      pins.set(storedRelay.host, storedRelay.fingerprint);
    }

    const webSocket = createHostRelayWebSocketFactory({
      relay: host.relay,
      pinFor: (url) => pins.get(url) ?? null,
    });

    const lifecycle = await createSyncLifecycle({
      stores,
      workspaceId,
      deviceName: await deviceName(),
      identity: () => identity,
      // The lifecycle's Node factory is replaced by the host transport; this is the
      // one place a renderer opens a relay connection and it never sees a URL's socket.
      webSocket,
      catchUpOn: "joined",
      reconnect: {},
      onGroupChanged: () => options.onChange?.(),
    });

    const next: Runtime = {
      plannerWorkspaceId,
      workspaceId,
      identity,
      stores,
      lifecycle,
      contacts: await stores.contacts.load(),
    };

    lifecycle.onUpdate((update) => {
      if (runtime !== next) return;
      void options.onDocumentUpdate(update);
    });
    lifecycle.onStatus(() => {
      if (runtime !== next) return;
      options.onChange?.();
    });
    lifecycle.onMembers(() => {
      if (runtime !== next) return;
      options.onChange?.();
    });
    const handOver = (): void => {
      if (runtime !== next) return;
      const snapshot = options.onDocumentSnapshot();
      if (snapshot !== null) void lifecycle.publish(snapshot).catch(() => undefined);
    };
    lifecycle.onJoinedByAnother(handOver);
    lifecycle.onConnected(handOver);

    runtime = next;
    // A join that was still waiting when the pack closed picks itself up here.
    void lifecycle.resume().catch(() => undefined);
    return next;
  }

  async function ensure(): Promise<Runtime> {
    const plannerWorkspaceId = await options.workspace();
    if (plannerWorkspaceId === null) throw new Error("No workspace is open.");
    if (runtime !== null && runtime.plannerWorkspaceId === plannerWorkspaceId) return runtime;
    if (opening !== null) {
      const pending = await opening;
      if (pending.plannerWorkspaceId === plannerWorkspaceId) return pending;
      // A different workspace finished opening first; drop it before building this one,
      // so two builds cannot race to assign `runtime`.
      await closeRuntime();
    }
    if (runtime !== null) await closeRuntime();
    opening = buildRuntime().finally(() => {
      opening = null;
    });
    return opening;
  }

  function infoOf(current: Runtime, status: SyncState = friendly(current.lifecycle.status())): SyncInfo {
    const friendCode = deriveFriendCode(current.identity.publicKey);
    return {
      workspaceId: current.workspaceId,
      deviceId: current.identity.deviceId,
      status,
      members: current.lifecycle.members().map((member) => ({
        deviceId: member.deviceId,
        name: member.name,
        role: member.role,
      })),
      friendCode,
      friendLink: formatFriendLink({ code: friendCode, publicKey: current.identity.publicKey }),
      contacts: current.contacts.map((contact) => ({
        code: contact.code,
        name: contact.name,
        addedAt: contact.addedAt,
        trusted: contact.trusted,
        ...(contact.deviceId === undefined ? {} : { deviceId: contact.deviceId }),
        ...(contact.publicKey === undefined ? {} : { publicKey: contact.publicKey }),
        ...(contact.lastSeenAt === undefined ? {} : { lastSeenAt: contact.lastSeenAt }),
      })),
    };
  }

  function refusal(reason: string): SyncInfo {
    if (runtime === null) return emptyInfo({ state: "refused", reason });
    return infoOf(runtime, { state: "refused", reason });
  }

  return {
    async info() {
      try {
        return infoOf(await ensure());
      } catch (error) {
        return emptyInfo(runtime === null ? { state: "off" } : friendly(runtime.lifecycle.status()));
      }
    },

    async enable(url, fingerprint) {
      if (host.relay === undefined) {
        return refusal("This host does not offer the relay capability, so this workspace stays local.");
      }
      try {
        const current = await ensure();
        rememberPin(url, fingerprint);
        const status = await current.lifecycle.connect(url, fingerprint);
        options.onChange?.();
        return infoOf(current, status);
      } catch (error) {
        return refusal(messageOf(error));
      }
    },

    async disable() {
      if (runtime === null) return emptyInfo({ state: "off" });
      await runtime.lifecycle.disconnect();
      options.onChange?.();
      return infoOf(runtime, { state: "off" });
    },

    async invite(role, to) {
      const current = await ensure();
      const relay = current.lifecycle.client();
      const hostUrl = current.lifecycle.hostUrl();
      if (relay === null || hostUrl === null) throw new Error("Sync is not connected.");

      const expiresAt = new Date((options.now?.() ?? new Date()).getTime() + INVITE_LIFETIME_MS).toISOString();
      const inviteId = randomHex(32);
      let target: string | undefined;
      if (to !== undefined) {
        const parsedTo = parseFriendCode(to);
        if (!parsedTo.ok) throw new Error(parsedTo.reason);
        target = parsedTo.code;
      }
      const unsigned = {
        workspaceId: current.workspaceId,
        inviteId,
        role,
        expiresAt,
        signerId: current.identity.deviceId,
      };
      const record: InviteRecord = {
        ...unsigned,
        signature: current.identity.sign(inviteRecordPayload(unsigned)),
      };
      relay.sendInvite(record);

      const body: FriendInviteBody = {
        from: {
          deviceId: current.identity.deviceId,
          publicKey: current.identity.publicKey,
        },
        relay: { url: hostUrl, fingerprint: current.lifecycle.relayFingerprint() },
        workspace: current.workspaceId,
        invite: inviteId,
        ...(target !== undefined ? { to: target } : {}),
        expiresAt,
        nonce: randomHex(16),
      };
      const friend: FriendInvite = {
        ...body,
        signature: current.identity.sign(friendInvitePayload(body)),
      };
      return formatInvite({ host: hostUrl, workspaceId: current.workspaceId, inviteId, friend });
    },

    async join(link, fingerprint) {
      const current = await ensure();
      const parsed = parseInvite(link);
      if (!parsed.ok) throw new Error(parsed.reason);
      if (parsed.value.workspaceId !== current.workspaceId) {
        throw new Error(
          "That invitation is for another workspace. Open a copy of the same workspace first.",
        );
      }
      if (current.lifecycle.group() !== null) {
        throw new Error("This device is already in this workspace.");
      }
      if (parsed.value.friend === undefined && !isLoopbackRelayUrl(parsed.value.host)) {
        throw new Error(LEGACY_REMOTE_MESSAGE);
      }

      let suppliedPin = fingerprint;
      const friend = parsed.value.friend;
      if (friend !== undefined) {
        const checked = verifyFriendInvite(friend, verifyEd25519);
        if (!checked.ok) throw new Error(friendRejection(checked.reason));

        const resolution = resolveFriendInvite(
          friend,
          current.contacts,
          deriveFriendCode(current.identity.publicKey),
        );
        switch (resolution.status) {
          case "known":
            current.contacts = await current.stores.contacts.noteSeen(current.contacts, friend);
            break;
          case "unknown":
            throw new Error(
              `This invitation is from friend code ${formatFriendCode(resolution.code)}. Add that code in Contacts, then join again.`,
            );
          case "untrusted":
            throw new Error(
              `Friend code ${formatFriendCode(resolution.code)} is saved but not trusted. Trust it in Contacts, then join again.`,
            );
          case "key-mismatch":
            throw new Error(
              `This invitation claims to be from ${formatFriendCode(resolution.code)}, but its key is not the one saved here. Remove and re-add the contact only if you trust this device.`,
            );
          case "for-someone-else":
            throw new Error("That invitation was written for a different friend code.");
          case "malformed-key":
            throw new Error("That invitation does not carry a usable identity key.");
        }

        if (friend.relay.fingerprint !== null && suppliedPin !== undefined) {
          const typed = normaliseFingerprint(suppliedPin);
          if (typed !== null && typed !== friend.relay.fingerprint) {
            throw new Error(
              "That invitation's certificate does not match the one in the field. Ask for a fresh invitation.",
            );
          }
        }
        suppliedPin = friend.relay.fingerprint ?? suppliedPin;
      }

      rememberPin(parsed.value.host, suppliedPin);
      const requested = await current.lifecycle.requestJoin({
        host: parsed.value.host,
        inviteId: parsed.value.inviteId,
        ...(suppliedPin === undefined ? {} : { fingerprint: suppliedPin }),
      });
      if (!requested.ok) throw new Error(requested.reason);
      options.onChange?.();
      return infoOf(current, requested.status);
    },

    async addContact(input) {
      const current = await ensure();
      current.contacts = await current.stores.contacts.remember(current.contacts, input);
      options.onChange?.();
      return infoOf(current);
    },

    async removeContact(code) {
      const current = await ensure();
      current.contacts = await current.stores.contacts.forget(current.contacts, code);
      options.onChange?.();
      return infoOf(current);
    },

    publish(update) {
      const current = runtime;
      if (current === null) return;
      void current.lifecycle.publish(update).catch(() => undefined);
    },

    async workspaceChanged() {
      await closeRuntime();
    },

    async dispose() {
      await closeRuntime();
    },
  };
}
