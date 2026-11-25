import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
  type SyncContact,
  signFrame,
  verifyFriendInvite,
} from "@suite/sync";
import {
  createSyncLifecycle,
  createSyncStores,
  EchoRefused,
  type SyncLifecycle,
} from "@suite/sync-desktop";
import type { SyncState } from "../../shared/ipc.js";
import {
  type DeviceIdentity,
  deviceIdFrom,
  loadOrCreateIdentity,
  readStoredIdentity,
  verifyEd25519,
  writeStoredIdentity,
} from "./identity.js";
import { exportKit, importKit } from "./kit.js";
import { recordKit } from "./kitReport.js";
import { createGenesis, readRootFile, writeRootFile } from "./rootStore.js";

/**
 * One workspace's sync, owned by the main process.
 *
 * The document lives in the renderer and the keys live here, so this service is a pair of
 * doors: a document update comes in from the renderer and leaves as a sealed frame; a frame
 * arrives from the host and leaves as a document update. Nothing else crosses.
 *
 * The socket, cursor, pending join, frame queue and pin resolution come from
 * `@suite/sync-desktop`. Canvas keeps what is its own: the identity file and the recovery
 * kit, presence and the revoke's numbered echo, the identity root, and every IPC name and
 * payload the window knows.
 *
 * It is deliberately not an Electron module. Paths and a socket factory are handed in, so
 * the whole thing can be tested without a window.
 */

/**
 * What this service is doing.
 *
 * The same shape the renderer receives, defined once in `shared/ipc.ts`: two unions that
 * describe one thing drift the first time either gains a state.
 */
export type SyncStatus = SyncState;

export interface SyncServiceOptions {
  readonly dataDir: string;
  readonly workspaceId: string;
  readonly webSocket?: RelayWebSocketFactory;
  /** What this device is called on the other person's screen. */
  readonly deviceName?: string;
  /**
   * How long a revoke waits for the relay to confirm the commit, before saying it failed.
   *
   * A relay that has gone away will never answer, and a person waiting on "removed" needs
   * an answer. Ten seconds is long enough for a slow socket and short enough to be honest.
   */
  readonly revokeEchoTimeoutMs?: number;
}

export interface SyncService {
  /** Connect to a host this device already belongs to. */
  connect(url: string, fingerprint?: string): Promise<SyncStatus>;
  disconnect(): Promise<void>;
  status(): SyncStatus;
  /** The device id and public key the host pins, for a pairing string. */
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
  /** Seal a document update from the renderer and send it. */
  publish(update: Uint8Array): Promise<void>;
  /** Write an invitation and hand back the link to give someone. */
  createInvite(role: "editor" | "viewer", to?: string): Promise<string>;
  /** Ask to join from a link somebody shared. Resolves once this device is in. */
  join(link: string, fingerprint?: string): Promise<SyncStatus>;
  /**
   * Pick up a join that was still waiting when the app closed.
   *
   * Does nothing when there is nothing to wait for, so a launch can call it unconditionally.
   */
  resume(): Promise<SyncStatus>;
  /** Who is in this workspace and what each of them may do, as the host last said. */
  members(): readonly RelayMember[];
  /**
   * Send presence: a small update nobody keeps.
   *
   * Sealed with a key derived from the group rather than with the group's application
   * ciphertext, because a dropped cursor must never leave a gap the next document update has
   * to work around.
   */
  presence(update: Uint8Array): Promise<void>;
  /** Somebody else's presence, already opened. Live only. */
  onPresence(handler: (update: Uint8Array) => void): void;
  /**
   * Take a device out of this workspace. Only an owner's record is applied.
   *
   * Resolves when the host has numbered the commit that rotates the epoch. A rejected
   * promise means the revoke did not complete, and the app must not say it did.
   */
  removeDevice(deviceId: string): Promise<void>;
  /** Write this device's way back in, plain or sealed with a passphrase. */
  exportKit(passphrase: string | null): Promise<Uint8Array>;
  /**
   * Install a way back in.
   *
   * Refuses a file for another workspace, and refuses to overwrite an identity that belongs
   * to a different device: that file is somebody else's install.
   */
  importKit(bytes: Uint8Array, passphrase: string | null): Promise<void>;
  /** Say what this device did about its way back in, for the hub's pane to read. */
  noteKit(state: "made" | "declined", sealed: boolean): Promise<void>;
  /**
   * The list of who is here changed.
   *
   * Separate from the status on purpose: a device joining does not change what sync is doing,
   * but it does change who a person is looking at when they open the dialog.
   */
  onMembers(handler: () => void): void;
  /**
   * Somebody was let in, so the app should hand over what the workspace already contains.
   *
   * A device that joins cannot read anything sealed before it joined, so without this it
   * joins an empty board and starts a second one.
   */
  onJoinedByAnother(handler: () => void): void;
  /** Hand out document updates from other devices. */
  onUpdate(handler: (update: Uint8Array) => void): void;
  onStatus(handler: (status: SyncStatus) => void): void;
  /** The certificate fingerprint this workspace requires, when the relay uses TLS. */
  relayFingerprint(): string | null;
}

/** How many times a revoke resends a commit the host refused as stale before giving up. */
const MAX_COMMIT_ATTEMPTS = 3;

const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A legacy link carries no signature, so only the local demo may still use one. */
const LEGACY_REMOTE_MESSAGE =
  "That is an old invitation without a signature. Ask for a new signed invitation.";

export async function createSyncService(options: SyncServiceOptions): Promise<SyncService> {
  // Reassigned only by a recovery file, which is the one thing that may replace it: the hub
  // pins this key, so a restored device has to answer with the key the hub already knows.
  let identity = await loadOrCreateIdentity(options.dataDir);
  /** What the other person's screen calls this device. */
  const deviceName = options.deviceName ?? "a Suite app";
  /** This installation's code; a recovery file can replace the identity, so read it fresh. */
  const ownFriendCode = (): string => deriveFriendCode(identity.publicKey);
  const stores = createSyncStores({
    dataDir: options.dataDir,
    workspaceId: options.workspaceId,
  });
  /** The people this installation knows. Adding one is the explicit act; nothing is pushed. */
  let contacts = await stores.contacts.load();
  let presenceHandler: ((update: Uint8Array) => void) | null = null;
  /** The presence key for the epoch we are in, derived once per epoch rather than per cursor. */
  let presenceKeyCache: { readonly epoch: number; readonly key: Uint8Array } | null = null;

  /**
   * The key presence is sealed with, for the epoch this device is in.
   *
   * Derived, not ratcheted: presence can arrive late, out of order or not at all without
   * costing anybody a document update. A device in a different epoch simply cannot open it,
   * which is the right answer for something that only describes the present.
   */
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
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const body = Buffer.concat([cipher.update(Buffer.from(update)), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64");
  }

  async function openPresence(payload: string): Promise<Uint8Array | null> {
    const key = await presenceKey();
    const bytes = decodeBase64(payload);
    if (key === null || bytes === null || bytes.length <= 28) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    } catch {
      // A cursor this device cannot read is not an error: it is what a device in another
      // epoch sees, by design, and there is nothing to recover or report.
      return null;
    }
  }

  const sync: SyncLifecycle = await createSyncLifecycle({
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
    // A brand-new workspace gets its identity root and the genesis that root signs. A
    // workspace shared before this existed has a group and no root, and nothing here
    // migrates it: it opens exactly as it did.
    onGroupCreated: async ({ url }) => {
      if ((await readRootFile(options.dataDir, options.workspaceId)) === null) {
        await createGenesis({
          dataDir: options.dataDir,
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          devicePublicKey: identity.publicKey,
          relay: url,
        });
      }
    },
    ...(options.webSocket === undefined ? {} : { webSocket: options.webSocket }),
  });

  return {
    connect: (url, fingerprint) => sync.connect(url, fingerprint),

    disconnect: () => sync.disconnect(),

    status: () => sync.status(),

    relayFingerprint: () => sync.relayFingerprint(),

    identity: async () => ({ deviceId: identity.deviceId, publicKey: identity.publicKey }),

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

    /**
     * Write an invitation and hand back the link to give someone.
     *
     * The role is decided here, by the person inviting, and travels inside the signed record
     * — so letting somebody in later does not ask the same question twice. The link also
     * carries a signed envelope naming this installation and the relay pin, so a person this
     * device has added connects without comparing a certificate by hand. The legacy fields
     * stay, so an older build still joins.
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
     * The identity behind the request has to be held until the welcome comes back — it is the
     * only thing that can open it — so the shared core writes it on disk the moment it is made.
     * An invitation is spent when the host stores this key package, so quitting between here
     * and the welcome would otherwise leave the other person adding a device that never appears.
     *
     * The trust decision is here, not in the shared core: the envelope is verified against the
     * key it carries, and the code it implies is resolved against *Canvas's* contacts.
     */
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

      // Deleting `e` must not turn a signed link into a legacy one that skips every check.
      // Legacy links stay useful for the local demo, and nowhere that leaves this machine.
      if (parsed.value.friend === undefined && !isLoopbackRelayUrl(parsed.value.host)) {
        sync.refuse(LEGACY_REMOTE_MESSAGE);
        return sync.status();
      }

      // A new link carries an envelope. Verify it and decide whether the person who sent it
      // is one this installation chose to know. An unknown code is refused, not trusted on
      // first use: adding the contact is the explicit act.
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

    /**
     * Take a device out.
     *
     * Two halves of one decision: the commitment that removes it from the group, which only
     * members can read, and the record the host can read so it stops carrying that device's
     * mail. The group moves to a new epoch, so everything sealed afterwards is unreadable to
     * the device that left — which is the whole of what "removed" can honestly mean.
     *
     * It resolves only when the host has numbered the commit and echoed it back. A frame
     * sent is not a frame stored: reporting "removed" before the echo is a promise about a
     * key rotation that may still be in flight. A removal record that landed without its
     * commit closes the door but leaves the old epoch readable to the device that left, so
     * a commit the host refuses as stale is sent again rather than reported as done.
     */
    async removeDevice(deviceId) {
      const group = sync.group();
      if (group === null || sync.client() === null) {
        throw new Error("This workspace is not shared yet.");
      }
      // The host refuses a removal record an owner did not sign, but a commit from any member
      // would still rotate the epoch for everybody. The decision is refused here, before a
      // commit is written, so an editor is never one socket message away from that.
      const own = sync.members().find((member) => member.deviceId === identity.deviceId);
      if (own?.role !== "owner") {
        throw new Error("Only the owner can remove a device.");
      }
      if (deviceId === identity.deviceId) {
        throw new Error("This device cannot remove itself.");
      }
      const name = sync.members().find((member) => member.deviceId === deviceId)?.name;
      // The device id first, because that is what a credential is now; the name is the fallback
      // for a group made before that was true, so an older workspace can still be tidied up.
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
      const removal = { ...unsigned, signature: identity.sign(removalRecordPayload(unsigned)) };

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
        const current = sync.client();
        if (current === null) throw new Error("The host went away before the removal finished.");
        const echo = sync.awaitEcho(commit.signature);
        current.send(commit);
        // The record is what closes the door, and it is sent once: a retry is about the
        // commit the door is waiting for, not about asking the host twice.
        if (attempt === 1) current.sendRemoval(removal);
        try {
          await echo;
          // The refusal that prompted a retry had already been published; the revoke is now
          // done, so the pill should not keep saying it was refused.
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
      const stored = await readStoredIdentity(options.dataDir);
      const group = sync.group();
      if (group === null) throw new Error("This workspace is not shared yet.");
      if (stored === null) throw new Error("This device has no identity to save.");
      const root = await readRootFile(options.dataDir, options.workspaceId);

      return exportKit(
        {
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          deviceName,
          group,
          identity: stored,
          ...(root === null ? {} : { root }),
        },
        passphrase,
      );
    },

    async noteKit(state, sealed) {
      await recordKit(options.dataDir, {
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        state,
        sealed,
      });
    },

    async importKit(bytes, passphrase) {
      const opened = importKit(bytes, passphrase);
      if (opened.workspaceId !== options.workspaceId) {
        throw new Error("That recovery file is for another workspace.");
      }
      if (deviceIdFrom(opened.identity.publicKey) !== opened.deviceId) {
        throw new Error("That recovery file does not match the device it names.");
      }
      // Only an install that has never joined anything may take a recovered device's place.
      // Anything else would be two machines answering to one id, which the hub refuses anyway.
      if (sync.group() !== null || sync.hasPendingJoin() || sync.createdHere()) {
        throw new Error("This device is already set up for this workspace.");
      }

      identity = await writeStoredIdentity(options.dataDir, opened.identity, true);
      await sync.setGroup(opened.group);
      // The root, when this kit came from the device that founded the workspace. A kit from
      // any other device carries none, because the root is never copied to one.
      if (opened.root !== null) {
        await writeRootFile(options.dataDir, options.workspaceId, opened.root);
      }
      // The file exists, which is what the hub reports; the device is not connected until
      // somebody connects it, and saying "syncing" before that would be a claim with no basis.
      await recordKit(options.dataDir, {
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        state: "made",
        sealed: (passphrase ?? "").trim().length > 0,
      });
    },

    onUpdate(handler) {
      sync.onUpdate(handler);
    },

    onStatus(handler) {
      sync.onStatus(handler);
    },
  };
}

/** The key a workspace's attachments and derived names would use. Nothing uses it yet. */
export async function workspaceKey(
  service: SyncService,
  workspaceId: string,
  dataDir: string,
): Promise<Uint8Array | null> {
  const group = await createSyncStores({ dataDir, workspaceId }).group.load();
  if (group === null) return null;
  void service;
  return exportKey(group, "suite/workspace-key", workspaceId);
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
