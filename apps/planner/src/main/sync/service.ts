import { randomBytes } from "node:crypto";

import type { SyncState } from "@suite/planner-core";
import {
  deriveFriendCode,
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
  type NewContact,
  normaliseFingerprint,
  parseFriendCode,
  parseInvite,
  type RelayMember,
  type RelayWebSocketFactory,
  resolveFriendInvite,
  type SyncContact,
  verifyFriendInvite,
} from "@suite/sync";
import { createSyncLifecycle, createSyncStores } from "@suite/sync-desktop";

import { type DeviceIdentity, loadOrCreateIdentity, verifyEd25519 } from "./identity";

/**
 * One Planner workspace's sync, owned by the main process.
 *
 * The document authority lives in main and so do the keys, so this service is a pair of
 * doors: a document update leaves as a sealed frame; a frame arrives and leaves as a
 * document update. The renderer never holds a key and never opens a socket.
 *
 * The socket, cursor, pending join, frame queue and reconnect policy come from
 * `@suite/sync-desktop`. What stays here is Planner's identity file, its contacts file and
 * the one decision that file exists for: whether a signed invitation is from someone this
 * installation chose to know.
 *
 * It is deliberately not an Electron module. Paths and a socket factory are handed in, so
 * the whole thing can be tested without a window.
 */
export interface PlannerSyncService {
  /** Share this workspace through a relay, or reconnect to one it already belongs to. */
  connect(url: string, fingerprint?: string): Promise<SyncState>;
  /** Stop syncing this copy. Membership and the file stay where they are. */
  disconnect(): Promise<void>;
  status(): SyncState;
  identity(): Promise<Pick<DeviceIdentity, "deviceId" | "publicKey">>;
  /** The code this installation shows a person when they want to be added. */
  friendCode(): string;
  /** The same code as `suite://friend`, including the key a scan would carry. */
  friendLink(): string;
  /** The people this installation has chosen to know, as the file holds them. */
  contacts(): readonly SyncContact[];
  /** Add a person by code, or complete one whose key arrived with the code. */
  addContact(input: NewContact): Promise<readonly SyncContact[]>;
  /** Forget a person. Their code can be added again. */
  removeContact(code: string): Promise<readonly SyncContact[]>;
  /** Who is in this workspace and what each of them may do, as the relay last said. */
  members(): readonly RelayMember[];
  /** Seal a document update and send it. */
  publish(update: Uint8Array): Promise<void>;
  /** Write an invitation and hand back the link to give someone. */
  createInvite(role: "editor" | "viewer", to?: string): Promise<string>;
  /** Ask to join from a link somebody shared. Resolves once this device has asked. */
  join(link: string, fingerprint?: string): Promise<SyncState>;
  /** Pick up a join that was still waiting when the app closed. */
  resume(): Promise<SyncState>;
  /** Hand out document updates from other devices. */
  onUpdate(handler: (update: Uint8Array) => void): void;
  onStatus(handler: (status: SyncState) => void): void;
  /** The list of who is here changed. */
  onMembers(handler: () => void): void;
  /**
   * Somebody was let in, so the app should hand over what the workspace already contains.
   *
   * A device that joins cannot read anything sealed before it joined, so without this it
   * joins an empty workspace and starts a second one.
   */
  onJoinedByAnother(handler: () => void): void;
  /**
   * This device is in a room it already belonged to (a first share or a reconnect).
   *
   * The app hands over a snapshot here too: edits made while the socket was down were
   * never published, and a snapshot is the one shape that carries them all.
   */
  onConnected(handler: () => void): void;
}

export interface PlannerSyncOptions {
  readonly dataDir: string;
  readonly workspaceId: string;
  readonly webSocket?: RelayWebSocketFactory;
  /** What this device is called on the other person's screen. */
  readonly deviceName?: string;
  /** First reconnect wait. Each failed attempt doubles it, up to the maximum. */
  readonly reconnectDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
}

const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A legacy link carries no signature, so only the local demo may still use one. */
const LEGACY_REMOTE_MESSAGE =
  "That is an old invitation without a signature. Ask for a new signed invitation.";

export async function createPlannerSyncService(
  options: PlannerSyncOptions,
): Promise<PlannerSyncService> {
  const identity = await loadOrCreateIdentity(options.dataDir);
  const ownFriendCode = deriveFriendCode(identity.publicKey);
  const deviceName = options.deviceName ?? "Planner";
  const stores = createSyncStores({
    dataDir: options.dataDir,
    workspaceId: options.workspaceId,
  });
  /** The people this installation knows. Adding one is the explicit act; nothing is pushed. */
  let contacts = await stores.contacts.load();
  const sync = await createSyncLifecycle({
    stores,
    workspaceId: options.workspaceId,
    deviceName,
    identity: () => identity,
    catchUpOn: "joined",
    reconnect: {
      ...(options.reconnectDelayMs === undefined ? {} : { delayMs: options.reconnectDelayMs }),
      ...(options.reconnectMaxDelayMs === undefined
        ? {}
        : { maxDelayMs: options.reconnectMaxDelayMs }),
    },
    ...(options.webSocket === undefined ? {} : { webSocket: options.webSocket }),
  });

  return {
    connect: (url, fingerprint) => sync.connect(url, fingerprint),

    disconnect: () => sync.disconnect(),

    status: () => sync.status(),

    identity: async () => ({ deviceId: identity.deviceId, publicKey: identity.publicKey }),

    friendCode: () => ownFriendCode,

    friendLink: () => formatFriendLink({ code: ownFriendCode, publicKey: identity.publicKey }),

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

    /**
     * Write an invitation and hand back the link to give someone.
     *
     * The role is decided here, by the person inviting, and travels inside the signed
     * record — so letting somebody in later does not ask the same question twice. The
     * link also carries a signed envelope, so a person this device has added can connect
     * without being asked to compare a certificate by hand. The legacy fields stay, so an
     * older build still joins.
     */
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
        nonce: randomBytes(16).toString("hex"),
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

    /**
     * Ask to join from a link somebody shared.
     *
     * The identity behind the request has to be held until the welcome comes back — it is
     * the only thing that can open it — so the shared core writes it on disk the moment it
     * is made. An invitation is spent when the relay stores this key package, so quitting
     * between here and the welcome would otherwise leave the other person adding a device
     * that never appears.
     *
     * The trust decision is here, not in the shared core: the envelope is verified against
     * the key it carries, and the code it implies is resolved against *Planner's* contacts.
     */
    async join(link, fingerprint) {
      const parsed = parseInvite(link);
      // A link this device cannot read is a thing to say where it was pasted, not a state for
      // the whole service. The caller shows the sentence and leaves the local face in place.
      if (!parsed.ok) throw new Error(parsed.reason);
      if (parsed.value.workspaceId !== options.workspaceId) {
        throw new Error(
          "That invitation is for another workspace. Open a copy of the same workspace first.",
        );
      }
      if (sync.group() !== null) throw new Error("This device is already in this workspace.");

      // Deleting `e` must not turn a signed link into a legacy one that skips every check.
      // Legacy links stay useful for the local demo, and nowhere that leaves this machine.
      if (parsed.value.friend === undefined && !isLoopbackRelayUrl(parsed.value.host)) {
        throw new Error(LEGACY_REMOTE_MESSAGE);
      }

      // A new link carries an envelope. Verify it, and decide whether the person who sent
      // it is one this installation chose to know. An unknown code is refused, not trusted
      // on first use: adding the contact is the explicit act.
      let suppliedPin = fingerprint;
      const friend = parsed.value.friend;
      if (friend !== undefined) {
        const checked = verifyFriendInvite(friend, verifyEd25519);
        if (!checked.ok) throw new Error(friendRejection(checked.reason));

        const resolution = resolveFriendInvite(friend, contacts, ownFriendCode);
        switch (resolution.status) {
          case "known":
            contacts = await stores.contacts.noteSeen(contacts, friend);
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
        // A known friend's envelope already pinned the certificate, so a person does not
        // have to compare it by hand. A typed pin still wins, and is checked above.
        suppliedPin = friend.relay.fingerprint ?? suppliedPin;
      }

      const requested = await sync.requestJoin({
        host: parsed.value.host,
        inviteId: parsed.value.inviteId,
        ...(suppliedPin === undefined ? {} : { fingerprint: suppliedPin }),
      });
      if (!requested.ok) throw new Error(requested.reason);
      return requested.status;
    },

    publish: (update) => sync.publish(update),

    onUpdate(handler) {
      sync.onUpdate(handler);
    },

    onStatus(handler) {
      sync.onStatus(handler);
    },

    onMembers(handler) {
      sync.onMembers(handler);
    },

    onJoinedByAnother(handler) {
      sync.onJoinedByAnother(handler);
    },

    onConnected(handler) {
      sync.onConnected(handler);
    },
  };
}

/** An invite id is 32 random bytes, written the way every other id in the protocol is. */
function randomInviteId(): string {
  return randomBytes(32).toString("hex");
}

/** A refused envelope, in a sentence the person holding the link can act on. */
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
