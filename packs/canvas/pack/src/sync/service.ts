import {
  decodeBase64,
  deriveFriendCode,
  encodeBase64,
  ephemeralPayload,
  exportKey,
  type FriendInvite,
  type FriendInviteBody,
  type FriendInviteRejection,
  formatFriendCode,
  formatFriendLink,
  formatInvite,
  friendInvitePayload,
  type InviteRecord,
  inviteRecordPayload,
  isLoopbackRelayUrl,
  leafIndexOf,
  type NewContact,
  normaliseFingerprint,
  parseFriendCode,
  parseInvite,
  type RelayMember,
  type RelayWebSocketFactory,
  removalRecordPayload,
  removeDevice as removeDeviceFromGroup,
  resolveFriendInvite,
  signFrame,
  type SyncContact,
  verifyFriendInvite,
} from "@suite/sync";
import type { RelayService } from "@suite/pack-runtime";
import {
  createRelaySyncLifecycle,
  createSyncStoresFor,
  EchoRefused,
  type SyncLifecycle,
  type SyncStatus,
} from "@suite/sync-desktop/relay";
import { gcm } from "@noble/ciphers/aes.js";

import type { SyncStoreFiles } from "./files.js";
import {
  deviceIdFrom,
  loadOrCreateIdentity,
  readStoredIdentity,
  verifyEd25519,
  writeStoredIdentity,
} from "./identity.js";
import { exportKit, importKit } from "./kit.js";
import { createHostRelaySocketFactory } from "./relaySocket.js";

/**
 * One workspace's sync, owned by the pack.
 *
 * The document lives in the renderer and so do the keys, sealed and opened here. The relay
 * service moves opaque bytes and never sees a document: a document update comes in, leaves as
 * a sealed frame, and a frame from another device leaves as bytes the document imports.
 *
 * This is Canvas's existing service with its Node edges replaced by the host's services: the
 * stores are the shared `@suite/sync-desktop` formats over the pack's `files` root, the socket
 * is the host's relay connection, and identity, the recovery kit and presence use renderer
 * primitives. The protocol, the group, the cursor and the reconnect policy are the same code
 * the frozen shell runs.
 */

export interface PackSyncServiceOptions {
  readonly files: SyncStoreFiles;
  readonly workspaceId: string;
  /** The host's opaque-frame service, or null when the host did not grant `relay`. */
  readonly relay: RelayService | null;
  /** What this device is called on the other person's screen. */
  readonly deviceName?: string;
  /** Test seam: a socket the suite drives instead of the host relay. */
  readonly webSocket?: RelayWebSocketFactory;
  readonly revokeEchoTimeoutMs?: number;
  readonly now?: () => Date;
}

export interface PackSyncService {
  connect(url: string, fingerprint?: string): Promise<SyncStatus>;
  disconnect(): Promise<void>;
  status(): SyncStatus;
  identity(): { deviceId: string; publicKey: string };
  friendCode(): string;
  friendLink(): string;
  contacts(): readonly SyncContact[];
  addContact(input: NewContact): Promise<readonly SyncContact[]>;
  removeContact(code: string): Promise<readonly SyncContact[]>;
  publish(update: Uint8Array): Promise<void>;
  createInvite(role: "editor" | "viewer", to?: string): Promise<string>;
  join(link: string, fingerprint?: string): Promise<SyncStatus>;
  resume(): Promise<SyncStatus>;
  members(): readonly RelayMember[];
  presence(update: Uint8Array): Promise<void>;
  onPresence(handler: (update: Uint8Array) => void): void;
  removeDevice(deviceId: string): Promise<void>;
  exportKit(passphrase: string | null): Promise<Uint8Array>;
  importKit(bytes: Uint8Array, passphrase: string | null): Promise<void>;
  noteKit(state: "made" | "declined", sealed: boolean): Promise<void>;
  kit(): "made" | "declined" | null;
  onMembers(handler: () => void): void;
  onJoinedByAnother(handler: () => void): void;
  onUpdate(handler: (update: Uint8Array) => void): void;
  onStatus(handler: (status: SyncStatus) => void): void;
  relayFingerprint(): string | null;
  relayUrl(): string | null;
  dispose(): Promise<void>;
}

/** How many times a revoke resends a commit the relay refused as stale before giving up. */
const MAX_COMMIT_ATTEMPTS = 3;

const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A legacy link carries no signature, so only the local demo may still use one. */
const LEGACY_REMOTE_MESSAGE =
  "That is an old invitation without a signature. Ask for a new signed invitation.";

const NO_RELAY_MESSAGE =
  "This host cannot open a relay connection, so sync is unavailable here. Use Suite Desk's relay or a host that grants it.";

export async function createPackSyncService(
  options: PackSyncServiceOptions,
): Promise<PackSyncService> {
  // Reassigned only by a recovery file, which is the one thing that may replace it.
  let identity = await loadOrCreateIdentity(options.files);
  const deviceName = options.deviceName ?? "Suite Canvas";
  const ownFriendCode = (): string => deriveFriendCode(identity.publicKey);
  const stores = createSyncStoresFor(options.files, options.workspaceId);
  let contacts = await stores.contacts.load();
  let presenceHandler: ((update: Uint8Array) => void) | null = null;
  let presenceKeyCache: { readonly epoch: number; readonly key: Uint8Array } | null = null;
  let kitState = await loadKitState();
  /** The last relay this workspace used, for the dialog after a reload before a connection. */
  let storedRelayHost = (await stores.relay.load())?.host ?? null;

  async function presenceKey(): Promise<Uint8Array | null> {
    const group = sync.group();
    if (group === null) return null;
    if (presenceKeyCache !== null && presenceKeyCache.epoch === group.epoch) {
      return presenceKeyCache.key;
    }
    const key = await exportKey(group, "suite/presence", options.workspaceId);
    presenceKeyCache = { epoch: group.epoch, key };
    return key;
  }

  async function sealPresence(update: Uint8Array): Promise<string | null> {
    const key = await presenceKey();
    if (key === null) return null;
    const nonce = randomBytes(12);
    const sealed = gcm(key, nonce).encrypt(update);
    const tag = sealed.subarray(sealed.length - 16);
    const body = sealed.subarray(0, sealed.length - 16);
    return encodeBase64(concat([nonce, tag, body]));
  }

  async function openPresence(payload: string): Promise<Uint8Array | null> {
    const key = await presenceKey();
    const bytes = decodeBase64(payload);
    if (key === null || bytes === null || bytes.length <= 28) return null;
    try {
      return gcm(key, bytes.subarray(0, 12)).decrypt(
        concat([bytes.subarray(28), bytes.subarray(12, 28)]),
      );
    } catch {
      // A cursor this device cannot read is what a device in another epoch sees, by design.
      return null;
    }
  }

  const webSocketFor = (fingerprint: string | null) => {
    if (options.webSocket !== undefined) return options.webSocket;
    if (options.relay === null) throw new Error(NO_RELAY_MESSAGE);
    return createHostRelaySocketFactory(options.relay, fingerprint);
  };

  const sync: SyncLifecycle = await createRelaySyncLifecycle({
    stores,
    workspaceId: options.workspaceId,
    deviceName,
    identity: () => identity,
    catchUpOn: "connect",
    reconnect: null,
    serialisePublish: false,
    ...(options.revokeEchoTimeoutMs === undefined
      ? {}
      : { echoTimeoutMs: options.revokeEchoTimeoutMs }),
    onEphemeral: (message) => {
      void openPresence(message.payload).then((update) => {
        if (update !== null) presenceHandler?.(update);
      });
    },
    onGroupChanged: () => {
      presenceKeyCache = null;
    },
    ...(options.webSocket === undefined ? {} : { webSocket: options.webSocket }),
    webSocketFor,
  });

  async function connect(url: string, fingerprint?: string): Promise<SyncStatus> {
    if (options.relay === null && options.webSocket === undefined) {
      sync.refuse(NO_RELAY_MESSAGE);
      return sync.status();
    }
    if (!/^wss?:\/\//u.test(url)) {
      sync.refuse("A relay address starts with ws:// or wss://.");
      return sync.status();
    }
    storedRelayHost = url;
    return sync.connect(url, fingerprint);
  }

  async function loadKitState(): Promise<"made" | "declined" | null> {
    const bytes = await options.files.read("sync/kit.json");
    if (bytes === null) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { state?: unknown };
      return parsed.state === "made" || parsed.state === "declined" ? parsed.state : null;
    } catch {
      return null;
    }
  }

  return {
    connect,

    disconnect: () => sync.disconnect(),

    status: () => sync.status(),

    relayFingerprint: () => sync.relayFingerprint(),

    relayUrl: () => sync.hostUrl() ?? storedRelayHost,

    identity: () => ({ deviceId: identity.deviceId, publicKey: identity.publicKey }),

    friendCode: () => ownFriendCode(),

    friendLink: () => formatFriendLink({ code: ownFriendCode(), publicKey: identity.publicKey }),

    contacts: () => contacts,

    async addContact(input) {
      contacts = await stores.contacts.remember(contacts, input);
      return contacts;
    },

    async removeContact(code) {
      contacts = await stores.contacts.forget(contacts, code);
      return contacts;
    },

    members: () => sync.members(),

    async createInvite(role, to) {
      const relay = sync.client();
      const hostUrl = sync.hostUrl();
      if (relay === null || hostUrl === null) throw new Error("Sync is not connected.");
      const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS).toISOString();
      const inviteId = randomInviteId();
      let target: string | undefined;
      if (to !== undefined) {
        const parsedTo = parseFriendCode(to);
        if (!parsedTo.ok) throw new Error(parsedTo.reason);
        target = parsedTo.code;
      }
      const unsigned = {
        workspaceId: options.workspaceId,
        inviteId,
        role,
        expiresAt,
        signerId: identity.deviceId,
      };
      const record: InviteRecord = {
        ...unsigned,
        signature: identity.sign(inviteRecordPayload(unsigned)),
      };
      relay.sendInvite(record);

      const body: FriendInviteBody = {
        from: { deviceId: identity.deviceId, publicKey: identity.publicKey },
        relay: { url: hostUrl, fingerprint: sync.relayFingerprint() },
        workspace: options.workspaceId,
        invite: inviteId,
        ...(target !== undefined ? { to: target } : {}),
        expiresAt,
        nonce: toHex(randomBytes(16)),
      };
      const friend: FriendInvite = {
        ...body,
        signature: identity.sign(friendInvitePayload(body)),
      };
      return formatInvite({
        host: hostUrl,
        workspaceId: options.workspaceId,
        inviteId,
        friend,
      });
    },

    resume: () => sync.resume(),

    async join(link, fingerprint) {
      const parsed = parseInvite(link);
      if (!parsed.ok) {
        sync.refuse(parsed.reason);
        return sync.status();
      }
      if (parsed.value.workspaceId !== options.workspaceId) {
        sync.refuse("That invitation is for another workspace.");
        return sync.status();
      }

      if (parsed.value.friend === undefined && !isLoopbackRelayUrl(parsed.value.host)) {
        sync.refuse(LEGACY_REMOTE_MESSAGE);
        return sync.status();
      }

      let suppliedPin = fingerprint;
      const friend = parsed.value.friend;
      if (friend !== undefined) {
        const checked = verifyFriendInvite(friend, verifyEd25519);
        if (!checked.ok) {
          sync.refuse(friendRejection(checked.reason));
          return sync.status();
        }

        const resolution = resolveFriendInvite(friend, contacts, ownFriendCode());
        switch (resolution.status) {
          case "known":
            contacts = await stores.contacts.noteSeen(contacts, friend);
            break;
          case "unknown":
            sync.refuse(
              `This invitation is from friend code ${formatFriendCode(resolution.code)}. Add that code in Contacts, then join again.`,
            );
            return sync.status();
          case "untrusted":
            sync.refuse(
              `Friend code ${formatFriendCode(resolution.code)} is saved but not trusted. Trust it in Contacts, then join again.`,
            );
            return sync.status();
          case "key-mismatch":
            sync.refuse(
              `This invitation claims to be from ${formatFriendCode(resolution.code)}, but its key is not the one saved here. Remove and re-add the contact only if you trust this device.`,
            );
            return sync.status();
          case "for-someone-else":
            sync.refuse("That invitation was written for a different friend code.");
            return sync.status();
          case "malformed-key":
            sync.refuse("That invitation does not carry a usable identity key.");
            return sync.status();
        }

        if (friend.relay.fingerprint !== null && suppliedPin !== undefined) {
          const typed = normaliseFingerprint(suppliedPin);
          if (typed !== null && typed !== friend.relay.fingerprint) {
            sync.refuse(
              "That invitation's certificate does not match the one in the field. Ask for a fresh invitation.",
            );
            return sync.status();
          }
        }
        suppliedPin = friend.relay.fingerprint ?? suppliedPin;
      }

      const requested = await sync.requestJoin({
        host: parsed.value.host,
        inviteId: parsed.value.inviteId,
        ...(suppliedPin === undefined ? {} : { fingerprint: suppliedPin }),
      });
      if (!requested.ok) {
        sync.refuse(requested.reason);
        return sync.status();
      }
      return requested.status;
    },

    publish: (update) => sync.publish(update),

    onJoinedByAnother(handler) {
      sync.onJoinedByAnother(handler);
    },

    onMembers(handler) {
      sync.onMembers(handler);
    },

    async presence(update) {
      const relay = sync.client();
      const group = sync.group();
      if (relay === null || group === null) return;
      const payload = await sealPresence(update);
      if (payload === null) return;
      const body = {
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        payload,
      };
      relay.sendEphemeral({ ...body, signature: identity.sign(ephemeralPayload(body)) });
    },

    onPresence(handler) {
      presenceHandler = handler;
    },

    async removeDevice(deviceId) {
      const group = sync.group();
      if (group === null || sync.client() === null) {
        throw new Error("This workspace is not shared yet.");
      }
      const own = sync.members().find((member) => member.deviceId === identity.deviceId);
      if (own?.role !== "owner") {
        throw new Error("Only the owner can remove a device.");
      }
      if (deviceId === identity.deviceId) {
        throw new Error("This device cannot remove itself.");
      }
      const name = sync.members().find((member) => member.deviceId === deviceId)?.name;
      const leaf =
        leafIndexOf(group, deviceId) ?? (name === undefined ? null : leafIndexOf(group, name));
      if (leaf === null) throw new Error("That device is not in this workspace.");

      const removed = await removeDeviceFromGroup(group, leaf);
      await sync.setGroup(removed.group);

      const commit = signFrame(identity.sign, {
        kind: "commit",
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: removed.group.epoch,
        payload: encodeBase64(removed.commit),
      });
      const unsigned = {
        workspaceId: options.workspaceId,
        deviceId,
        removedAt: new Date().toISOString(),
        signerId: identity.deviceId,
      };

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
        const current = sync.client();
        if (current === null) throw new Error("The host went away before the removal finished.");
        const echo = sync.awaitEcho(commit.signature);
        current.send(commit);
        // The record closes the door and is sent once: a retry is about the commit the door is
        // waiting for, not about asking the host twice.
        if (attempt === 1) {
          current.sendRemoval({
            ...unsigned,
            signature: identity.sign(removalRecordPayload(unsigned)),
          });
        }
        try {
          await echo;
          sync.refreshStatus();
          return;
        } catch (error) {
          lastError = error;
          if (
            error instanceof EchoRefused &&
            error.reason === "stale-epoch" &&
            attempt < MAX_COMMIT_ATTEMPTS
          ) {
            continue;
          }
          break;
        }
      }
      throw new Error(
        lastError instanceof Error
          ? `The removal did not complete: ${lastError.message}`
          : "The removal did not complete.",
      );
    },

    async exportKit(passphrase) {
      const stored = await readStoredIdentity(options.files);
      const group = sync.group();
      if (group === null) throw new Error("This workspace is not shared yet.");
      if (stored === null) throw new Error("This device has no identity to save.");
      return exportKit(
        {
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          deviceName,
          group,
          identity: stored,
          ...(options.now === undefined ? {} : { now: options.now() }),
        },
        passphrase,
      );
    },

    async noteKit(state: "made" | "declined", _sealed: boolean) {
      kitState = state;
      await options.files.write(
        "sync/kit.json",
        new TextEncoder().encode(`${JSON.stringify({ version: 1, state })}\n`),
      );
    },

    kit: () => kitState,

    async importKit(bytes, passphrase) {
      const opened = importKit(bytes, passphrase);
      if (opened.workspaceId !== options.workspaceId) {
        throw new Error("That recovery file is for another workspace.");
      }
      if (deviceIdFrom(opened.identity.publicKey) !== opened.deviceId) {
        throw new Error("That recovery file does not match the device it names.");
      }
      if (sync.group() !== null || sync.hasPendingJoin() || sync.createdHere()) {
        throw new Error("This device is already set up for this workspace.");
      }

      identity = await writeStoredIdentity(options.files, opened.identity, true);
      await sync.setGroup(opened.group);
      kitState = "made";
    },

    onUpdate(handler) {
      sync.onUpdate(handler);
    },

    onStatus(handler) {
      sync.onStatus(handler);
    },

    async dispose() {
      await sync.disconnect();
    },
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

/** An invite id is 32 random bytes, written the way every other id in the protocol is. */
function randomInviteId(): string {
  return toHex(randomBytes(32));
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}
