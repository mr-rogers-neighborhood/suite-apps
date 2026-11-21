import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  addDevice,
  applyCommit,
  createDeviceIdentity,
  createRelayClient,
  createWorkspaceGroup,
  decodeBase64,
  decodeKeyPackageBytes,
  deriveFriendCode,
  encodeBase64,
  encodeKeyPackageBytes,
  ephemeralPayload,
  exportKey,
  type Frame,
  type FriendInvite,
  type FriendInviteBody,
  type FriendInviteRejection,
  formatFriendCode,
  formatFriendLink,
  formatInvite,
  frameRejection,
  friendInvitePayload,
  type InviteRecord,
  inviteRecordPayload,
  isLoopbackRelayUrl,
  joinWorkspaceGroup,
  leafIndexOf,
  type MemberRole,
  type NewContact,
  normaliseFingerprint,
  open as openMessage,
  parseFriendCode,
  parseInvite,
  type RelayClient,
  type RelayClientHandlers,
  type RelayMember,
  type RelayWebSocketFactory,
  removalRecordPayload,
  removeDevice as removeDeviceFromGroup,
  resolveFriendInvite,
  roleRecordPayload,
  type SyncContact,
  seal,
  signFrame,
  verifyFriendInvite,
} from "@suite/sync";
import {
  createNodeWebSocketFactory,
  PIN_MALFORMED_MESSAGE,
  PIN_REQUIRED_MESSAGE,
  RelayPinError,
} from "@suite/sync/node";
import type { SyncState } from "../../shared/ipc.js";
import { forgetContact, loadContacts, noteSeen, rememberContact } from "./contactsStore.js";
import { loadCursor, saveCursor } from "./cursorStore.js";
import { isOwned, loadGroup, markOwned, saveGroup } from "./groupStore.js";
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
import { clearPending, loadPending, type PendingJoin, savePending } from "./pendingStore.js";
import { loadRelayConfig, saveRelayConfig } from "./relayConfig.js";
import { createGenesis, readRootFile, writeRootFile } from "./rootStore.js";

/**
 * One workspace's sync, owned by the main process.
 *
 * The document lives in the renderer and the keys live here, so this service is a pair of
 * doors: a document update comes in from the renderer and leaves as a sealed frame; a frame
 * arrives from the host and leaves as a document update. Nothing else crosses.
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

/** Plaintext is local only; an address that leaves this machine needs TLS and a pin. */
const PLAINTEXT_REMOTE_MESSAGE =
  "Plaintext sync is only for a relay on this machine. Ask for a wss:// address and its certificate fingerprint.";

/** A legacy link carries no signature, so only the local demo may still use one. */
const LEGACY_REMOTE_MESSAGE =
  "That is an old invitation without a signature. Ask for a new signed invitation.";

interface EchoWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * The host refused the message a revoke was waiting on.
 *
 * `stale-epoch` is the one refusal worth retrying: the commit was written against an
 * epoch the host has since moved past, and sending it again is what the design asks for.
 * Every other reason means the revoke cannot land as written.
 */
class EchoRefused extends Error {
  constructor(readonly reason: string) {
    super(`the host refused the commit: ${reason}`);
    this.name = "EchoRefused";
  }
}

export async function createSyncService(options: SyncServiceOptions): Promise<SyncService> {
  // Reassigned only by a recovery file, which is the one thing that may replace it: the hub
  // pins this key, so a restored device has to answer with the key the hub already knows.
  let identity = await loadOrCreateIdentity(options.dataDir);
  /** What the other person's screen calls this device. */
  const deviceName = options.deviceName ?? "a Suite app";
  /** This installation's code; a recovery file can replace the identity, so read it fresh. */
  const ownFriendCode = (): string => deriveFriendCode(identity.publicKey);
  /** The people this installation knows. Adding one is the explicit act; nothing is pushed. */
  let contacts = await loadContacts(options.dataDir);
  let group = await loadGroup(options.dataDir, options.workspaceId);
  /** The relay this workspace last used, and the certificate it must present. */
  const storedRelay = await loadRelayConfig(options.dataDir, options.workspaceId);
  let relayHost: string | null = storedRelay?.host ?? null;
  let pinnedFingerprint: string | null = storedRelay?.fingerprint ?? null;
  let relay: RelayClient | null = null;
  let status: SyncStatus = { state: "off" };
  let updateHandler: ((update: Uint8Array) => void) | null = null;
  let statusHandler: ((status: SyncStatus) => void) | null = null;
  let joinedHandler: (() => void) | null = null;
  let membersHandler: (() => void) | null = null;
  /** The address written into a link, remembered from the last connection. */
  let hostUrl: string | null = null;
  /** Who the host says is here, refreshed on every join and on every change to a role. */
  let members: readonly RelayMember[] = [];
  let presenceHandler: ((update: Uint8Array) => void) | null = null;
  /** Set when an owner took this device out, so the socket closing is not read as a fault. */
  let removedByOwner = false;
  /** The presence key for the epoch we are in, derived once per epoch rather than per cursor. */
  let presenceKeyCache: { readonly epoch: number; readonly key: Uint8Array } | null = null;
  /**
   * A device that asked to be let in, and the role its invitation promised.
   *
   * The host announces this before it relays the key package, so letting the device in knows
   * what record to write without asking the person a question their invitation already
   * answered. An entry that is never used expires with the service.
   */
  const waitingRoles = new Map<string, MemberRole>();
  /** A join in flight: the identity whose key package is waiting for a welcome. */
  let pending: PendingJoin | null = await loadPending(options.dataDir, options.workspaceId);
  /**
   * The last frame this device applied, as the host numbered it.
   *
   * Persisted beside the group, because a count held in a variable means nothing after a
   * restart: it starts at zero, drifts when a frame is replayed, and cannot name a point in
   * the host's log. `null` means nothing has been applied and the next catch-up starts at 0.
   */
  let cursor: number | null = await loadCursor(options.dataDir, options.workspaceId);
  /** The queue that keeps frame handling in order, one at a time. */
  let frames: Promise<void> = Promise.resolve();
  /** A catch-up already asked for, so a burst of out-of-step frames asks once per gap. */
  let catchUpFrom: number | null = null;
  /** Revokes waiting for the numbered echo of a commit, keyed by the commit's signature. */
  const echoWaiters = new Map<string, EchoWaiter>();

  /** Frames applied, for a status line. The cursor is what a catch-up uses. */
  const applied = (): number => (cursor === null ? 0 : cursor + 1);

  /**
   * Decide which certificate this connection must present, and remember it.
   *
   * Plaintext is only for loopback, and a `wss://` address has no fallback: without a pin
   * there is nothing to trust, so the answer is a refusal with the line a person can copy.
   * A supplied pin wins over the stored one, which is how a rotated certificate is entered.
   */
  async function resolvePin(
    url: string,
    supplied: string | undefined,
  ): Promise<
    | { readonly ok: true; readonly fingerprint: string | null }
    | { readonly ok: false; readonly reason: string }
  > {
    const trimmed = url.trim();
    const lower = trimmed.toLowerCase();
    const secure = lower.startsWith("wss://");
    if (!secure) {
      if (!lower.startsWith("ws://") || !isLoopbackRelayUrl(trimmed)) {
        return { ok: false, reason: PLAINTEXT_REMOTE_MESSAGE };
      }
      relayHost = url;
      pinnedFingerprint = null;
      await saveRelayConfig(options.dataDir, options.workspaceId, {
        host: url,
        fingerprint: null,
      });
      return { ok: true, fingerprint: null };
    }

    const typed = supplied?.trim() ?? "";
    let fingerprint: string | null = null;
    if (typed.length > 0) {
      fingerprint = normaliseFingerprint(typed);
      if (fingerprint === null) return { ok: false, reason: PIN_MALFORMED_MESSAGE };
    } else if (relayHost === url && pinnedFingerprint !== null) {
      fingerprint = pinnedFingerprint;
    }
    if (fingerprint === null) return { ok: false, reason: PIN_REQUIRED_MESSAGE };

    relayHost = url;
    pinnedFingerprint = fingerprint;
    await saveRelayConfig(options.dataDir, options.workspaceId, { host: url, fingerprint });
    return { ok: true, fingerprint };
  }

  const publishStatus = (next: SyncStatus): void => {
    status = next;
    statusHandler?.(next);
  };

  /**
   * Ask for the frames after the cursor, when a frame is newer than this device's epoch.
   *
   * A newer frame — even an application frame — means a commit is missing; opening it
   * would either fail or, worse, quietly do nothing while the workspace looks current.
   * The cursor is the only point in the host's log this device can name.
   */
  function requestCatchUp(): void {
    if (relay === null) return;
    const from = cursor === null ? 0 : cursor + 1;
    if (catchUpFrom === from) return;
    catchUpFrom = from;
    relay.since(from);
  }

  /** Move the durable cursor, once, in order. A gap is caught up rather than skipped. */
  async function advanceCursor(index: number): Promise<void> {
    if (cursor !== null && index <= cursor) return;
    cursor = index;
    catchUpFrom = null;
    await saveCursor(options.dataDir, options.workspaceId, index);
  }

  /**
   * Wait for the host to number and echo the frame that carries a decision.
   *
   * A frame that was sent is not a frame that was stored. The numbered echo is the only
   * thing that says the host has it, and a revoke that reports success before it is a
   * promise about a key rotation that may still be in flight.
   */
  function awaitEcho(signature: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        echoWaiters.delete(signature);
        reject(new Error("The host did not confirm that the commit was stored."));
      }, options.revokeEchoTimeoutMs ?? 10_000);
      echoWaiters.set(signature, { resolve, reject, timer });
    });
  }

  function settleEcho(signature: string): void {
    const waiter = echoWaiters.get(signature);
    if (waiter === undefined) return;
    clearTimeout(waiter.timer);
    echoWaiters.delete(signature);
    waiter.resolve();
  }

  function rejectEchoes(error: Error): void {
    for (const signature of [...echoWaiters.keys()]) {
      const waiter = echoWaiters.get(signature);
      if (waiter === undefined) continue;
      clearTimeout(waiter.timer);
      echoWaiters.delete(signature);
      waiter.reject(error);
    }
  }

  /** This device started this workspace's group, so it may own it if nobody does. */
  let startedHere = await isOwned(options.dataDir, options.workspaceId);

  /**
   * Claim the workspace, but only when there is nobody to claim it from.
   *
   * The host allows exactly one bootstrap: a self-signed owner record while it has no owners.
   * A device that was let into somebody else's workspace must never take that door, which is
   * why the claim needs both the marker written when this device created the group and a host
   * that has no owner on record.
   */
  function claimOwnership(): void {
    if (relay === null || !startedHere) return;
    if (members.some((member) => member.role === "owner")) return;
    const unsigned = {
      workspaceId: options.workspaceId,
      deviceId: identity.deviceId,
      role: "owner" as const,
      seq: 0,
      signerId: identity.deviceId,
    };
    relay.setRole({ ...unsigned, signature: identity.sign(roleRecordPayload(unsigned)) });
  }

  /**
   * The key presence is sealed with, for the epoch this device is in.
   *
   * Derived, not ratcheted: presence can arrive late, out of order or not at all without
   * costing anybody a document update. A device in a different epoch simply cannot open it,
   * which is the right answer for something that only describes the present.
   */
  async function presenceKey(): Promise<Uint8Array | null> {
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

  const handlers: RelayClientHandlers = {
    onJoined: (info) => {
      members = info.members;
      claimOwnership();
      publishStatus({ state: "syncing", count: info.frames });
    },
    onFrame: (index, frame) => {
      // The numbered echo says the host has stored what this device sent, which is what a
      // revoke waits for. It is settled before the frame is applied, because the answer is
      // about the host's log, not about the local group.
      settleEcho(frame.signature);
      // One at a time, in the order the host sent them. Applying a frame is not a pure read:
      // opening a welcome creates the group, and opening an application message ratchets the
      // secret tree. Run two at once and a snapshot that followed a welcome is evaluated before
      // the group exists — the joiner then sits in a workspace it cannot read.
      frames = frames
        .then(async () => {
          // A frame this device already applied is a replay, not a second change.
          if (cursor !== null && index <= cursor) return;
          // A gap means a frame before this one is missing. Catch up in index order rather
          // than opening something whose commit has not arrived.
          if (cursor !== null && index > cursor + 1) {
            requestCatchUp();
            return;
          }
          if (await applyFrame(frame)) await advanceCursor(index);
        })
        .catch(() => undefined);
    },
    onWaiting: (waiting) => {
      waitingRoles.set(waiting.deviceId, waiting.role);
    },
    onRoster: (roster) => {
      members = roster.members;
      membersHandler?.();
    },
    onEphemeral: (message) => {
      void openPresence(message.payload).then((update) => {
        if (update !== null) presenceHandler?.(update);
      });
    },
    onRemoved: () => {
      removedByOwner = true;
      pending = null;
      rejectEchoes(new Error("This device was removed before the commit was confirmed."));
      void clearPending(options.dataDir, options.workspaceId);
      relay?.close();
      relay = null;
      publishStatus({ state: "removed" });
    },
    onRefused: (reason) => {
      rejectEchoes(new EchoRefused(reason));
      publishStatus({ state: "refused", reason });
    },
    onError: (code, message) => publishStatus({ state: "asleep", reason: `${code}: ${message}` }),
    onClosed: () => {
      // A socket that closes because somebody removed this device is not a host that went to
      // sleep, and saying so would offer a retry that can never work.
      if (removedByOwner) return;
      rejectEchoes(new Error("The host went away before it confirmed the commit."));
      publishStatus({ state: "asleep", reason: "the host is not answering" });
    },
  };

  /**
   * Somebody asked to join, so let them in.
   *
   * The invitation already decided who and in what role, and the host has spent it by the
   * time this frame arrives. Asking the owner to confirm the same decision twice is how a
   * prompt becomes something people click past.
   */
  async function admitDevice(frame: Frame, role: MemberRole): Promise<void> {
    if (group === null || relay === null) return;

    const payload = decodeBase64(frame.payload);
    if (payload === null) return;

    const added = await addDevice(group, decodeKeyPackageBytes(payload));
    group = added.group;
    await saveGroup(options.dataDir, options.workspaceId, group);

    relay.send(
      signFrame(identity.sign, {
        kind: "commit",
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: added.group.epoch,
        payload: encodeBase64(added.commit),
      }),
    );
    relay.send(
      signFrame(identity.sign, {
        kind: "welcome",
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: added.group.epoch,
        payload: encodeBase64(added.welcome),
      }),
    );

    // The role the invitation granted. Without it the device is in the group but may not
    // write, which reads as a broken workspace rather than a missing step.
    const unsigned = {
      workspaceId: options.workspaceId,
      deviceId: frame.deviceId,
      role,
      seq: 0,
      signerId: identity.deviceId,
    };
    relay.setRole({ ...unsigned, signature: identity.sign(roleRecordPayload(unsigned)) });

    // Now the document itself: the app hands over a snapshot, which is what a device that
    // cannot read anything from before it joined actually needs.
    joinedHandler?.();
  }

  /** This device was let in, so take the welcome and become part of the group. */
  /**
   * Somebody else changed who is in the group, so move to the epoch they made.
   *
   * Without this a member is left at the epoch it joined in: it would read nothing that came
   * after an Add or a Remove and would never say so, because a frame it cannot open is not an
   * error. That is the difference between "removed" working for the person who removed and
   * working for everybody else.
   */
  async function applyCommitFromPeer(frame: Frame): Promise<void> {
    const current = group;
    if (current === null) return;
    const payload = decodeBase64(frame.payload);
    if (payload === null) return;
    try {
      const applied = await applyCommit(current, payload);
      group = applied.group;
      presenceKeyCache = null;
      await saveGroup(options.dataDir, options.workspaceId, group);
    } catch {
      // A commit this device cannot apply is one it is already past, or one for a group it is
      // no longer in. Neither is worth telling a person about.
    }
  }

  async function acceptWelcome(frame: Frame): Promise<void> {
    if (pending === null) return;
    const payload = decodeBase64(frame.payload);
    if (payload === null) return;

    try {
      group = await joinWorkspaceGroup(payload, pending.identity);
      pending = null;
      await clearPending(options.dataDir, options.workspaceId);
      await saveGroup(options.dataDir, options.workspaceId, group);
      publishStatus({ state: "syncing", count: applied() });
    } catch {
      publishStatus({ state: "refused", reason: "That invitation could not be used." });
    }
  }

  /**
   * Apply one frame, and say whether it was consumed.
   *
   * `false` means "do not move the cursor": the frame is newer than this device's epoch,
   * so a commit before it is missing and the answer is to catch up from the cursor rather
   * than to open something the group cannot read yet.
   */
  async function applyFrame(frame: Frame): Promise<boolean> {
    // A welcome is the one frame a device with no group is waiting for, so it is handled
    // before any of the epoch reasoning below — the joiner has no epoch to compare against.
    if (frame.kind === "welcome") {
      await acceptWelcome(frame);
      return true;
    }

    // A key package is not group traffic: it carries epoch 0 because the asking device has no
    // group, and it is the join request, not a message in the ordering. It is handled before
    // the epoch rule for the same reason the host exempts it from the epoch floor.
    if (frame.kind === "keypackage") {
      // Only a device the host has just announced, and only once. A key package replayed from
      // the log on connect is a device that is already a member, so adding it again would put
      // a second copy in the tree and a second join on everyone's screen.
      const role = waitingRoles.get(frame.deviceId);
      if (role === undefined) return true;
      waitingRoles.delete(frame.deviceId);
      await admitDevice(frame, role);
      return true;
    }

    if (group === null) return true;

    // One rule for every frame that is group traffic. Exact equality is right for an
    // application frame; a commit one epoch ahead is how this device moves, and everything
    // else is either already past (drop) or not reachable yet (catch up in index order).
    const verdict = frameRejection(frame, {
      workspaceId: options.workspaceId,
      epoch: group.epoch,
    });
    if (verdict !== null) {
      // A frame from an epoch this device has left is not late, it is irrelevant; MLS would
      // quietly decrypt it as an old application message rather than refuse it.
      if (verdict === "wrong-workspace" || frame.epoch < group.epoch) return true;
      // Newer, and not the commit that moves us: a commit is missing. Do not open it.
      requestCatchUp();
      return false;
    }

    if (frame.kind === "commit") {
      await applyCommitFromPeer(frame);
      return true;
    }

    if (frame.kind !== "application") return true;

    const payload = decodeBase64(frame.payload);
    if (payload === null) return true;

    try {
      const opened = await openMessage(group, payload);
      group = opened.group;
      await saveGroup(options.dataDir, options.workspaceId, group);
      const plaintext: Uint8Array | null = opened.plaintext;
      if (plaintext !== null) updateHandler?.(plaintext);
    } catch {
      // A frame this device cannot read is not an error worth surfacing: it is what a device
      // that joined later sees of the past, by design.
    }
    return true;
  }

  /**
   * Turn sync on for this workspace.
   *
   * Sharing a workspace that has never been shared is where its group is made: one member,
   * this device, in the first epoch. Joining somebody else's does not come through here —
   * that group arrives inside the welcome — so this is the only place a group is created, and
   * creating it is also what makes this device the workspace's owner.
   *
   * It is also where a brand-new workspace gets its identity root and the genesis that root
   * signs. A workspace shared before this existed has a group and no root, and nothing here
   * migrates it: it opens exactly as it did.
   */
  async function share(url: string, fingerprint?: string): Promise<SyncStatus> {
    const pin = await resolvePin(url, fingerprint);
    if (!pin.ok) {
      publishStatus({ state: "refused", reason: pin.reason });
      return status;
    }
    if (group === null) {
      group = await createWorkspaceGroup(
        options.workspaceId,
        await createDeviceIdentity(deviceName),
      );
      await saveGroup(options.dataDir, options.workspaceId, group);
      await markOwned(options.dataDir, options.workspaceId);
      startedHere = true;
      if ((await readRootFile(options.dataDir, options.workspaceId)) === null) {
        await createGenesis({
          dataDir: options.dataDir,
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          devicePublicKey: identity.publicKey,
          relay: url,
        });
      }
    }
    return connectTo(url, pin.fingerprint);
  }

  async function connectTo(url: string, fingerprint: string | null): Promise<SyncStatus> {
    if (relay !== null) return status;
    publishStatus({ state: "connecting" });
    hostUrl = url;
    try {
      relay = await createRelayClient(
        {
          url,
          workspaceId: options.workspaceId,
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          name: deviceName,
          sign: identity.sign,
          ...(options.webSocket === undefined
            ? {
                webSocket:
                  fingerprint === null
                    ? createNodeWebSocketFactory()
                    : createNodeWebSocketFactory({ fingerprint }),
              }
            : { webSocket: options.webSocket }),
        },
        handlers,
      );
      // Ask for what arrived while this device was closed, once the client exists. The
      // cursor is the host's own numbering, written beside the group, so it survives a
      // restart and a replayed frame; a count in a variable would mean nothing here. A
      // device that has never applied a frame asks from the start.
      catchUpFrom = null;
      requestCatchUp();
    } catch (error) {
      publishStatus(
        error instanceof RelayPinError
          ? { state: "refused", reason: error.message }
          : {
              state: "asleep",
              reason: error instanceof Error ? error.message : "the host is not answering",
            },
      );
    }
    return status;
  }

  return {
    connect: share,

    async disconnect() {
      relay?.close();
      relay = null;
      publishStatus({ state: "off" });
    },

    status: () => status,

    relayFingerprint: () => pinnedFingerprint,

    identity: async () => ({ deviceId: identity.deviceId, publicKey: identity.publicKey }),

    friendCode: () => ownFriendCode(),

    friendLink: () => formatFriendLink({ code: ownFriendCode(), publicKey: identity.publicKey }),

    contacts: () => contacts,

    async addContact(input) {
      contacts = await rememberContact(options.dataDir, contacts, input);
      return contacts;
    },

    async removeContact(code) {
      contacts = await forgetContact(options.dataDir, contacts, code);
      return contacts;
    },

    members: () => members,

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
      if (relay === null || hostUrl === null) throw new Error("Sync is not connected.");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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
        relay: { url: hostUrl, fingerprint: pinnedFingerprint },
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

    /**
     * Pick up a join that was still waiting when the app closed.
     *
     * The key package is already on the host and the invitation it spent is already gone, so
     * there is nothing to send: this reconnects where the device asked and waits for the
     * welcome that follows. A launch calls it without knowing whether there is anything to
     * resume.
     */
    async resume() {
      if (pending === null || relay !== null) return status;
      const pin = await resolvePin(pending.host, undefined);
      if (!pin.ok) {
        publishStatus({ state: "refused", reason: pin.reason });
        return status;
      }
      await connectTo(pending.host, pin.fingerprint);
      if (relay === null) return status;
      publishStatus({ state: "waiting" });
      return status;
    },

    /**
     * Ask to join from a link somebody shared.
     *
     * The identity behind the request has to be held until the welcome comes back — it is the
     * only thing that can open it — so it goes on disk the moment it is made. An invitation is
     * spent when the host stores this key package, so quitting between here and the welcome
     * would otherwise leave the other person adding a device that never appears.
     */
    async join(link, fingerprint) {
      const parsed = parseInvite(link);
      if (!parsed.ok) {
        publishStatus({ state: "refused", reason: parsed.reason });
        return status;
      }
      if (parsed.value.workspaceId !== options.workspaceId) {
        publishStatus({ state: "refused", reason: "That invitation is for another workspace." });
        return status;
      }

      // Deleting `e` must not turn a signed link into a legacy one that skips every check.
      // Legacy links stay useful for the local demo, and nowhere that leaves this machine.
      if (parsed.value.friend === undefined && !isLoopbackRelayUrl(parsed.value.host)) {
        publishStatus({ state: "refused", reason: LEGACY_REMOTE_MESSAGE });
        return status;
      }

      // A new link carries an envelope. Verify it and decide whether the person who sent it
      // is one this installation chose to know. An unknown code is refused, not trusted on
      // first use: adding the contact is the explicit act.
      let suppliedPin = fingerprint;
      const friend = parsed.value.friend;
      if (friend !== undefined) {
        const checked = verifyFriendInvite(friend, verifyEd25519);
        if (!checked.ok) {
          publishStatus({ state: "refused", reason: friendRejection(checked.reason) });
          return status;
        }

        const resolution = resolveFriendInvite(friend, contacts, ownFriendCode());
        switch (resolution.status) {
          case "known":
            contacts = await noteSeen(options.dataDir, contacts, friend);
            break;
          case "unknown":
            publishStatus({
              state: "refused",
              reason: `This invitation is from friend code ${formatFriendCode(resolution.code)}. Add that code in Contacts, then join again.`,
            });
            return status;
          case "untrusted":
            publishStatus({
              state: "refused",
              reason: `Friend code ${formatFriendCode(resolution.code)} is saved but not trusted. Trust it in Contacts, then join again.`,
            });
            return status;
          case "key-mismatch":
            publishStatus({
              state: "refused",
              reason: `This invitation claims to be from ${formatFriendCode(resolution.code)}, but its key is not the one saved here. Remove and re-add the contact only if you trust this device.`,
            });
            return status;
          case "for-someone-else":
            publishStatus({
              state: "refused",
              reason: "That invitation was written for a different friend code.",
            });
            return status;
          case "malformed-key":
            publishStatus({
              state: "refused",
              reason: "That invitation does not carry a usable identity key.",
            });
            return status;
        }

        if (friend.relay.fingerprint !== null && suppliedPin !== undefined) {
          const typed = normaliseFingerprint(suppliedPin);
          if (typed !== null && typed !== friend.relay.fingerprint) {
            publishStatus({
              state: "refused",
              reason:
                "That invitation's certificate does not match the one in the field. Ask for a fresh invitation.",
            });
            return status;
          }
        }
        suppliedPin = friend.relay.fingerprint ?? suppliedPin;
      }

      const pin = await resolvePin(parsed.value.host, suppliedPin);
      if (!pin.ok) {
        publishStatus({ state: "refused", reason: pin.reason });
        return status;
      }

      await connectTo(parsed.value.host, pin.fingerprint);
      if (relay === null) return status;

      // The group's credential is the device id, not the name: names are cosmetic and two
      // devices may share one, but removing the wrong device is not a cosmetic mistake.
      const asked = await createDeviceIdentity(identity.deviceId);
      pending = { identity: asked, host: parsed.value.host };
      await savePending(options.dataDir, options.workspaceId, asked, parsed.value.host);
      const header = {
        kind: "keypackage" as const,
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: 0,
        payload: encodeBase64(encodeKeyPackageBytes(asked.keyPackage)),
      };
      relay.sendKeyPackage({
        inviteId: parsed.value.inviteId,
        deviceId: identity.deviceId,
        publicKey: identity.publicKey,
        name: deviceName,
        frame: signFrame(identity.sign, header),
      });
      publishStatus({ state: "waiting" });
      return status;
    },

    onJoinedByAnother(handler) {
      joinedHandler = handler;
    },

    onMembers(handler) {
      membersHandler = handler;
    },

    async presence(update) {
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
      if (group === null || relay === null) throw new Error("This workspace is not shared yet.");
      const name = members.find((member) => member.deviceId === deviceId)?.name;
      // The device id first, because that is what a credential is now; the name is the fallback
      // for a group made before that was true, so an older workspace can still be tidied up.
      const leaf =
        leafIndexOf(group, deviceId) ?? (name === undefined ? null : leafIndexOf(group, name));
      if (leaf === null) throw new Error("That device is not in this workspace.");

      const removed = await removeDeviceFromGroup(group, leaf);
      group = removed.group;
      presenceKeyCache = null;
      await saveGroup(options.dataDir, options.workspaceId, group);

      const commit = signFrame(identity.sign, {
        kind: "commit",
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: group.epoch,
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
        const current = relay;
        if (current === null) throw new Error("The host went away before the removal finished.");
        const echo = awaitEcho(commit.signature);
        current.send(commit);
        // The record is what closes the door, and it is sent once: a retry is about the
        // commit the door is waiting for, not about asking the host twice.
        if (attempt === 1) current.sendRemoval(removal);
        try {
          await echo;
          // The refusal that prompted a retry had already been published; the revoke is now
          // done, so the pill should not keep saying it was refused.
          publishStatus({ state: "syncing", count: applied() });
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
      if (group !== null || pending !== null || startedHere) {
        throw new Error("This device is already set up for this workspace.");
      }

      identity = await writeStoredIdentity(options.dataDir, opened.identity, true);
      group = opened.group;
      presenceKeyCache = null;
      await saveGroup(options.dataDir, options.workspaceId, group);
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

    async publish(update) {
      if (relay === null || group === null) return;
      const sealed = await seal(group, update);
      group = sealed.group;
      await saveGroup(options.dataDir, options.workspaceId, group);

      const header = {
        kind: "application" as const,
        workspaceId: options.workspaceId,
        deviceId: identity.deviceId,
        epoch: sealed.group.epoch,
        payload: encodeBase64(sealed.message),
      };
      relay.send(signFrame(identity.sign, header));
    },

    onUpdate(handler) {
      updateHandler = handler;
    },

    onStatus(handler) {
      statusHandler = handler;
    },
  };
}

/** The key a workspace's attachments and derived names would use. Nothing uses it yet. */
export async function workspaceKey(
  service: SyncService,
  workspaceId: string,
  dataDir: string,
): Promise<Uint8Array | null> {
  const group = await loadGroup(dataDir, workspaceId);
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
