import { randomBytes } from "node:crypto";

import type { SyncMemberRole, SyncState } from "@suite/planner-core";
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
  type NewContact,
  normaliseFingerprint,
  open as openMessage,
  parseFriendCode,
  parseInvite,
  type RelayClient,
  type RelayClientHandlers,
  type RelayMember,
  type RelayWebSocketFactory,
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

import { forgetContact, loadContacts, noteSeen, rememberContact } from "./contactsStore";
import { loadCursor, saveCursor } from "./cursorStore";
import { isOwned, loadGroup, markOwned, saveGroup } from "./groupStore";
import { type DeviceIdentity, loadOrCreateIdentity, verifyEd25519 } from "./identity";
import { clearPending, loadPending, type PendingJoin, savePending } from "./pendingStore";
import { loadRelayConfig, saveRelayConfig } from "./relayConfig";

/**
 * One Planner workspace's sync, owned by the main process.
 *
 * The document authority lives in main and so do the keys, so this service is a pair of
 * doors: a document update leaves as a sealed frame; a frame arrives and leaves as a
 * document update. The renderer never holds a key and never opens a socket.
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
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 15_000;

/** Plaintext is local only; an address that leaves this machine needs TLS and a pin. */
const PLAINTEXT_REMOTE_MESSAGE =
  "Plaintext sync is only for a relay on this machine. Ask for a wss:// address and its certificate fingerprint.";

/** A legacy link carries no signature, so only the local demo may still use one. */
const LEGACY_REMOTE_MESSAGE =
  "That is an old invitation without a signature. Ask for a new signed invitation.";

export async function createPlannerSyncService(
  options: PlannerSyncOptions,
): Promise<PlannerSyncService> {
  const identity = await loadOrCreateIdentity(options.dataDir);
  const ownFriendCode = deriveFriendCode(identity.publicKey);
  const deviceName = options.deviceName ?? "Planner";
  /** The people this installation knows. Adding one is the explicit act; nothing is pushed. */
  let contacts = await loadContacts(options.dataDir);
  let group = await loadGroup(options.dataDir, options.workspaceId);
  /** The relay this workspace last used, and the certificate it must present. */
  const storedRelay = await loadRelayConfig(options.dataDir, options.workspaceId);
  let relayHost: string | null = storedRelay?.host ?? null;
  let pinnedFingerprint: string | null = storedRelay?.fingerprint ?? null;
  let relay: RelayClient | null = null;
  let status: SyncState = { state: "off" };
  let updateHandler: ((update: Uint8Array) => void) | null = null;
  let statusHandler: ((status: SyncState) => void) | null = null;
  let membersHandler: (() => void) | null = null;
  let joinedHandler: (() => void) | null = null;
  let connectedHandler: (() => void) | null = null;
  /** The address written into a link, remembered from the last connection. */
  let hostUrl: string | null = null;
  /** Who the relay says is here, refreshed on every join and on every role change. */
  let members: readonly RelayMember[] = [];
  /** Set when an owner took this device out, so the socket closing is not read as a fault. */
  let removedByOwner = false;
  /** True after an explicit stop, which a closed socket must not undo. */
  let stopped = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  /** Bumped on every connection, so a callback from a closed socket changes nothing. */
  let generation = 0;
  /**
   * A device that asked to be let in, and the role its invitation promised.
   *
   * The relay announces this before it relays the key package, so letting the device in
   * knows what record to write without asking a question the invitation already answered.
   */
  const waitingRoles = new Map<string, SyncMemberRole>();
  /** A join in flight: the identity whose key package is waiting for a welcome. */
  let pending: PendingJoin | null = await loadPending(options.dataDir, options.workspaceId);
  /**
   * The last frame this device applied, as the relay numbered it.
   *
   * Persisted beside the group, because a count held in a variable means nothing after a
   * restart: it starts at zero, drifts when a frame is replayed, and cannot name a point in
   * the relay's log. `null` means nothing has been applied and the next catch-up starts at 0.
   */
  let cursor: number | null = await loadCursor(options.dataDir, options.workspaceId);
  /**
   * One queue for every group operation, in order.
   *
   * Opening a frame and sealing one both change the MLS state. Run them at once and a
   * snapshot that followed a welcome is evaluated before the group exists, or a seal
   * finishes against an epoch an incoming commit has already moved past.
   */
  let queue: Promise<void> = Promise.resolve();
  /** A catch-up already asked for, so a burst of out-of-step frames asks once per gap. */
  let catchUpFrom: number | null = null;

  /** This device started this workspace's group, so it may own it if nobody does. */
  let startedHere = await isOwned(options.dataDir, options.workspaceId);

  const applied = (): number => (cursor === null ? 0 : cursor + 1);

  const publishStatus = (next: SyncState): void => {
    status = next;
    statusHandler?.(next);
  };

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

  function enqueue(work: () => Promise<void>): Promise<void> {
    queue = queue.then(work).catch(() => undefined);
    return queue;
  }

  /**
   * Ask for the frames after the cursor, when a frame is newer than this device's epoch.
   *
   * A newer frame — even an application frame — means a commit is missing; opening it would
   * either fail or, worse, quietly do nothing while the workspace looks current.
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

  /** This device started this group, so claim the workspace while nobody owns it. */
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

  /** Somebody asked to join, so let them in and then hand them a copy of the workspace. */
  async function admitDevice(frame: Frame, role: SyncMemberRole): Promise<void> {
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

    // Now the document itself, which is what a device that cannot read anything from before
    // it joined actually needs.
    joinedHandler?.();
  }

  /**
   * Somebody else changed who is in the group, so move to the epoch they made.
   *
   * Without this a member is left at the epoch it joined in: it would read nothing that came
   * after an Add or a Remove and would never say so, because a frame it cannot open is not
   * an error.
   */
  async function applyCommitFromPeer(frame: Frame): Promise<void> {
    const current = group;
    if (current === null) return;
    const payload = decodeBase64(frame.payload);
    if (payload === null) return;
    try {
      const applied = await applyCommit(current, payload);
      group = applied.group;
      await saveGroup(options.dataDir, options.workspaceId, group);
    } catch {
      // A commit this device cannot apply is one it is already past, or one for a group it
      // is no longer in. Neither is worth telling a person about.
    }
  }

  /** This device was let in, so take the welcome and become part of the group. */
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
      // This copy may have edits made before the invitation arrived. Hand them over now.
      connectedHandler?.();
    } catch {
      publishStatus({ state: "refused", reason: "That invitation could not be used." });
    }
  }

  /**
   * Apply one frame, and say whether it was consumed.
   *
   * `false` means "do not move the cursor": the frame is newer than this device's epoch,
   * so a commit before it is missing and the answer is to catch up rather than open
   * something the group cannot read yet.
   */
  async function applyFrame(frame: Frame): Promise<boolean> {
    // A welcome is the one frame a device with no group is waiting for, so it is handled
    // before any of the epoch reasoning below — the joiner has no epoch to compare against.
    if (frame.kind === "welcome") {
      await acceptWelcome(frame);
      return true;
    }

    // A key package is not group traffic: it carries epoch 0 because the asking device has
    // no group, and it is the join request, not a message in the ordering.
    if (frame.kind === "keypackage") {
      // Only a device the relay has just announced, and only once. A key package replayed
      // from the log on connect is a device that is already a member, so adding it again
      // would put a second copy in the tree and a second join on everyone's screen.
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

  function clearReconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  /**
   * Try the same relay again after it goes away.
   *
   * A relay that is restarted is not a workspace that stopped existing, and a person should
   * not have to reopen the dialog to reconnect. The wait doubles so a relay that is off for
   * the evening is one timer, not a busy loop.
   */
  function scheduleReconnect(): void {
    if (stopped || hostUrl === null || reconnectTimer !== null) return;
    const base = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    const ceiling = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const wait = Math.min(base * 2 ** reconnectAttempt, ceiling);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectTo(hostUrl ?? "", pinnedFingerprint);
    }, wait);
  }

  /** One connection's handlers, tagged so a stale socket cannot change the current state. */
  function handlersFor(connection: number): RelayClientHandlers {
    const current = (): boolean => connection === generation;
    return {
      onJoined: (info) => {
        if (!current()) return;
        members = info.members;
        claimOwnership();
        publishStatus({ state: "syncing", count: info.frames });
        // Ask only now. A `since` sent before the relay has answered `join` is refused as
        // "not joined", and a refused catch-up is indistinguishable from an empty one.
        catchUpFrom = null;
        requestCatchUp();
        // Already a member (a first share or a reconnect): hand over a snapshot, because
        // edits made while the socket was down were never published as frames.
        if (group !== null) connectedHandler?.();
      },
      onFrame: (index, frame) => {
        if (!current()) return;
        // One at a time, in the order the relay sent them. Applying a frame is not a pure
        // read: opening a welcome creates the group and opening an application message
        // ratchets the secret tree.
        void enqueue(async () => {
          // A frame this device already applied is a replay, not a second change.
          if (cursor !== null && index <= cursor) return;
          // A gap means a frame before this one is missing. Catch up in index order rather
          // than opening something whose commit has not arrived.
          if (cursor !== null && index > cursor + 1) {
            requestCatchUp();
            return;
          }
          if (await applyFrame(frame)) await advanceCursor(index);
        });
      },
      onWaiting: (waiting) => {
        if (!current()) return;
        waitingRoles.set(waiting.deviceId, waiting.role);
      },
      onRoster: (roster) => {
        if (!current()) return;
        members = roster.members;
        membersHandler?.();
      },
      onEphemeral: () => undefined,
      onRemoved: () => {
        if (!current()) return;
        removedByOwner = true;
        stopped = true;
        clearReconnect();
        pending = null;
        void clearPending(options.dataDir, options.workspaceId);
        relay?.close();
        relay = null;
        publishStatus({ state: "removed" });
      },
      onRefused: (reason) => {
        if (!current()) return;
        publishStatus({ state: "refused", reason });
      },
      onError: (code, message) => {
        if (!current()) return;
        publishStatus({ state: "asleep", reason: `${code}: ${message}` });
      },
      onClosed: () => {
        if (!current()) return;
        relay = null;
        // A socket that closes because somebody removed this device is not a relay that
        // went to sleep, and saying so would offer a retry that can never work.
        if (removedByOwner) return;
        publishStatus({ state: "asleep", reason: "the relay is not answering" });
        scheduleReconnect();
      },
    };
  }

  async function connectTo(url: string, fingerprint: string | null): Promise<SyncState> {
    if (relay !== null) return status;
    stopped = false;
    removedByOwner = false;
    clearReconnect();
    hostUrl = url;
    publishStatus({ state: "connecting" });
    const connection = ++generation;
    try {
      const client = await createRelayClient(
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
        handlersFor(connection),
      );
      // A disconnect while the socket was opening wins: the client is not ours to keep.
      if (connection !== generation || stopped) {
        client.close();
        return status;
      }
      relay = client;
      reconnectAttempt = 0;
    } catch (error) {
      if (connection !== generation) return status;
      relay = null;
      publishStatus(
        error instanceof RelayPinError
          ? { state: "refused", reason: error.message }
          : {
              state: "asleep",
              reason: error instanceof Error ? error.message : "the relay is not answering",
            },
      );
      if (!(error instanceof RelayPinError)) scheduleReconnect();
    }
    return status;
  }

  /**
   * Turn sync on for this workspace.
   *
   * Sharing a workspace that has never been shared is where its group is made: one member,
   * this device, in the first epoch. That is also what makes this device the owner.
   * Joining somebody else's does not come through here — that group arrives in the welcome.
   */
  async function share(url: string, fingerprint?: string): Promise<SyncState> {
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
    }
    return connectTo(url, pin.fingerprint);
  }

  return {
    connect: share,

    async disconnect() {
      stopped = true;
      clearReconnect();
      generation += 1;
      relay?.close();
      relay = null;
      publishStatus({ state: "off" });
    },

    status: () => status,

    identity: async () => ({ deviceId: identity.deviceId, publicKey: identity.publicKey }),

    friendCode: () => ownFriendCode,

    friendLink: () => formatFriendLink({ code: ownFriendCode, publicKey: identity.publicKey }),

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
     * The role is decided here, by the person inviting, and travels inside the signed
     * record — so letting somebody in later does not ask the same question twice. The
     * link also carries a signed envelope, so a person this device has added can connect
     * without being asked to compare a certificate by hand. The legacy fields stay, so an
     * older build still joins.
     */
    async createInvite(role, to) {
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
     * The key package is already on the relay and the invitation it spent is already gone,
     * so there is nothing to send: this reconnects where the device asked and waits for the
     * welcome that follows.
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
     * The identity behind the request has to be held until the welcome comes back — it is
     * the only thing that can open it — so it goes on disk the moment it is made. An
     * invitation is spent when the relay stores this key package, so quitting between here
     * and the welcome would otherwise leave the other person adding a device that never
     * appears.
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
      if (group !== null) throw new Error("This device is already in this workspace.");

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
            contacts = await noteSeen(options.dataDir, contacts, friend);
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

      const pin = await resolvePin(parsed.value.host, suppliedPin);
      if (!pin.ok) throw new Error(pin.reason);

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

    /** Seal a document update and send it, one at a time with every other group change. */
    publish(update) {
      return enqueue(async () => {
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
      });
    },

    onUpdate(handler) {
      updateHandler = handler;
    },

    onStatus(handler) {
      statusHandler = handler;
    },

    onMembers(handler) {
      membersHandler = handler;
    },

    onJoinedByAnother(handler) {
      joinedHandler = handler;
    },

    onConnected(handler) {
      connectedHandler = handler;
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
