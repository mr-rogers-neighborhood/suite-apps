import {
  addDevice,
  applyCommit,
  createDeviceIdentity,
  createRelayClient,
  createWorkspaceGroup,
  type DeviceGroup,
  decodeBase64,
  decodeKeyPackageBytes,
  type EphemeralMessage,
  encodeBase64,
  encodeKeyPackageBytes,
  type Frame,
  frameRejection,
  isLoopbackRelayUrl,
  joinWorkspaceGroup,
  normaliseFingerprint,
  open as openMessage,
  type RelayClient,
  type RelayClientHandlers,
  type RelayMember,
  type RelayWebSocketFactory,
  roleRecordPayload,
  seal,
  signFrame,
} from "@suite/sync";
import type { SyncStores } from "./stores/index.js";

/**
 * The pin sentences, duplicated here so the shared lifecycle has no `node:` import.
 *
 * `@suite/sync/node` exports the same two lines for the Electron hosts. A pack cannot import
 * that module — it reaches for `node:crypto` and `node:tls` — so the words live beside the
 * rule they explain and the two copies are asserted equal in the sync-desktop tests.
 */
export const PIN_REQUIRED_MESSAGE =
  "This relay uses wss://, so its certificate fingerprint is required. " +
  "Copy the SHA-256 fingerprint line suite-sync prints at startup.";
export const PIN_MALFORMED_MESSAGE =
  "That is not a certificate fingerprint. Copy the SHA-256 fingerprint line suite-sync prints at startup.";

/** A refusal from the pin, carrying a sentence a person can act on. */
export class RelayPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayPinError";
  }
}

/**
 * A final refusal from either side of the bridge.
 *
 * The Node socket throws `@suite/sync/node`'s class, and a pack's adapter throws either its own
 * `RelayPinError` or a subclass. The names are the portable part: a bundle cannot share a class
 * identity across an alias, and Planner's capability refusal deliberately extends its pin error
 * so the lifecycle stops rather than retrying. Both names are accepted, and the reason reaches
 * the person.
 */
function isPinRefusal(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "RelayPinError" || error.name === "RelayCapabilityRefused")
  );
}

/** How the core opens a socket: the caller supplies the implementation and its pin. */
export type OpenSyncWebSocket = (fingerprint: string | null) => RelayWebSocketFactory;

/**
 * What sync is doing, as one value.
 *
 * Structurally the same union both apps already expose to their renderers. It lives here
 * because the lifecycle owns the transitions; each app keeps its own alias at the IPC edge.
 */
export type SyncStatus =
  | { readonly state: "off" }
  | { readonly state: "connecting" }
  | { readonly state: "syncing"; readonly count: number }
  | { readonly state: "asleep"; readonly reason: string }
  | { readonly state: "refused"; readonly reason: string }
  | { readonly state: "waiting" }
  | { readonly state: "removed" };

/** The installation key the lifecycle signs with. The app owns the file and the key. */
export interface SyncIdentity {
  /** SHA-256 of the raw Ed25519 public key, lower-case hex. */
  readonly deviceId: string;
  /** Base64 of the 32 raw Ed25519 bytes. */
  readonly publicKey: string;
  sign(payload: Uint8Array | string): string;
}

/** A join the app has already accepted, before the key package is sent. */
export interface PreparedJoin {
  readonly host: string;
  readonly inviteId: string;
  /** A pin the person typed, which wins over the stored one. */
  readonly fingerprint?: string;
}

export type JoinRequestResult =
  | { readonly ok: true; readonly status: SyncStatus }
  | { readonly ok: false; readonly reason: string };

/**
 * The relay policy the app chooses.
 *
 * `null` is a deliberate "no automatic retry": Canvas has none today, and turning one on
 * would change what a closed socket means to its dialog. Planner passes both delays and
 * keeps the doubling wait it already had.
 */
export interface ReconnectPolicy {
  readonly delayMs?: number;
  readonly maxDelayMs?: number;
}

export interface SyncLifecycleOptions {
  /** The app's stores, rooted at that app's data directory. */
  readonly stores: SyncStores;
  readonly workspaceId: string;
  /** What this device is called on the other person's screen. */
  readonly deviceName: string;
  /** Read the current installation key; a recovery file may replace it. */
  readonly identity: () => SyncIdentity;
  readonly webSocket?: RelayWebSocketFactory;
  /** `null` (the default) leaves a closed socket closed. */
  readonly reconnect?: ReconnectPolicy | null;
  /**
   * When to ask for frames after the cursor.
   *
   * Planner asks after `joined`, because a `since` sent before the relay has answered `join`
   * is refused. Canvas has always asked as soon as the client exists and its tests drive that
   * order, so the difference is kept rather than silently rewritten.
   */
  readonly catchUpOn?: "connect" | "joined";
  /**
   * Seal a document update inside the ordered queue.
   *
   * Planner already serialises publish against incoming frames because sealing and opening
   * both move the MLS state. Canvas has always published outside its frame queue, so the
   * default here is the safe policy and Canvas opts out to keep its current ordering.
   */
  readonly serialisePublish?: boolean;
  /** How long a revoke waits for the numbered echo of its commit. */
  readonly echoTimeoutMs?: number;
  /** The app's presence opener, when it has one (Canvas). */
  readonly onEphemeral?: (message: EphemeralMessage) => void;
  /** Called whenever the group state is replaced, so an app can drop derived keys. */
  readonly onGroupChanged?: () => void;
  /** Called once, when a first share creates the group and marks it owned. */
  readonly onGroupCreated?: (context: {
    readonly group: DeviceGroup;
    readonly url: string;
  }) => Promise<void> | void;
}

/**
 * The part of desktop sync that is the same in both apps.
 *
 * It owns the socket, the relay pin, the durable cursor, the pending join, the ordered frame
 * queue and the reconnect policy. It does not own the app's identity file, its contacts
 * decision, its capability surface or its IPC names: the app passes those in and keeps them.
 */
export interface SyncLifecycle {
  readonly workspaceId: string;
  status(): SyncStatus;
  members(): readonly RelayMember[];
  /** The current group, for an app method that must derive a key from it. */
  group(): DeviceGroup | null;
  /** Whether a join is waiting for its welcome, for an import that must not overwrite one. */
  hasPendingJoin(): boolean;
  /** Whether this device started the group, which a recovery import must not overwrite. */
  createdHere(): boolean;
  /** Replace the group and persist it; the app calls this after an import or a revoke. */
  setGroup(group: DeviceGroup | null): Promise<void>;
  /** The live client, for an app method the lifecycle does not own (invite, presence). */
  client(): RelayClient | null;
  hostUrl(): string | null;
  relayFingerprint(): string | null;
  /** Share or reconnect; creates the group on the first share. */
  connect(url: string, fingerprint?: string): Promise<SyncStatus>;
  disconnect(): Promise<void>;
  /** Pick up a join that was still waiting when the app closed. */
  resume(): Promise<SyncStatus>;
  /** Send the key package for a join the app has already accepted. */
  requestJoin(prepared: PreparedJoin): Promise<JoinRequestResult>;
  /** Seal one document update and send it. */
  publish(update: Uint8Array): Promise<void>;
  /** Publish a local refusal, for a trust decision the app made before connecting. */
  refuse(reason: string): void;
  /** Re-publish `syncing` at the current cursor, after an app-driven group change. */
  refreshStatus(): void;
  /** Wait for the relay to number and echo a frame the app sent. */
  awaitEcho(signature: string): Promise<void>;
  onUpdate(handler: (update: Uint8Array) => void): void;
  onStatus(handler: (status: SyncStatus) => void): void;
  onMembers(handler: () => void): void;
  onJoinedByAnother(handler: () => void): void;
  onConnected(handler: () => void): void;
}

/**
 * The relay refused the frame a revoke was waiting on.
 *
 * `stale-epoch` is the one refusal worth retrying: the commit was written against an epoch
 * the relay has since moved past. Every other reason means the revoke cannot land as written.
 */
export class EchoRefused extends Error {
  constructor(readonly reason: string) {
    super(`the host refused the commit: ${reason}`);
    this.name = "EchoRefused";
  }
}

interface EchoWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 15_000;

/** Plaintext is local only; an address that leaves this machine needs TLS and a pin. */
const PLAINTEXT_REMOTE_MESSAGE =
  "Plaintext sync is only for a relay on this machine. Ask for a wss:// address and its certificate fingerprint.";

export async function createSyncLifecycleCore(
  options: SyncLifecycleOptions,
  openWebSocket: OpenSyncWebSocket,
): Promise<SyncLifecycle> {
  const { stores, workspaceId } = options;
  const identity = options.identity;
  const reconnect = options.reconnect ?? null;
  const catchUpOn = options.catchUpOn ?? "joined";
  const serialisePublish = options.serialisePublish ?? true;

  let group = await stores.group.load();
  /** This device started this workspace's group, so it may own it if nobody does. */
  let startedHere = await stores.group.isOwned();
  /** A join in flight: the identity whose key package is waiting for a welcome. */
  let pending = await stores.pending.load();
  /**
   * The last frame this device applied, as the relay numbered it.
   *
   * Persisted beside the group, because a count held in a variable means nothing after a
   * restart. `null` means nothing has been applied and the next catch-up starts at 0.
   */
  let cursor = await stores.cursor.load();
  /** The relay this workspace last used, and the certificate it must present. */
  const storedRelay = await stores.relay.load();
  let relayHost: string | null = storedRelay?.host ?? null;
  let pinnedFingerprint: string | null = storedRelay?.fingerprint ?? null;
  let relay: RelayClient | null = null;
  let status: SyncStatus = { state: "off" };
  let updateHandler: ((update: Uint8Array) => void) | null = null;
  let statusHandler: ((status: SyncStatus) => void) | null = null;
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
  const waitingRoles = new Map<string, RelayMember["role"]>();
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
  /** Revokes waiting for the numbered echo of a commit, keyed by the commit's signature. */
  const echoWaiters = new Map<string, EchoWaiter>();

  /** Frames applied, for a status line. The cursor is what a catch-up uses. */
  const applied = (): number => (cursor === null ? 0 : cursor + 1);

  const publishStatus = (next: SyncStatus): void => {
    status = next;
    statusHandler?.(next);
  };

  function enqueue(work: () => Promise<void>): Promise<void> {
    queue = queue.then(work).catch(() => undefined);
    return queue;
  }

  /**
   * Ask for the frames after the cursor, when a frame is newer than this device's epoch.
   *
   * A newer frame — even an application frame — means a commit is missing; opening it
   * would either fail or, worse, quietly do nothing while the workspace looks current.
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
    await stores.cursor.save(index);
  }

  async function replaceGroup(next: DeviceGroup): Promise<void> {
    group = next;
    await stores.group.save(next);
    options.onGroupChanged?.();
  }

  /** This device started this group, so claim the workspace while nobody owns it. */
  function claimOwnership(): void {
    if (relay === null || !startedHere) return;
    if (members.some((member) => member.role === "owner")) return;
    const current = identity();
    const unsigned = {
      workspaceId,
      deviceId: current.deviceId,
      role: "owner" as const,
      seq: 0,
      signerId: current.deviceId,
    };
    relay.setRole({ ...unsigned, signature: current.sign(roleRecordPayload(unsigned)) });
  }

  /**
   * Wait for the relay to number and echo the frame that carries a decision.
   *
   * A frame that was sent is not a frame that was stored. The numbered echo is the only
   * thing that says the relay has it, and a revoke that reports success before it is a
   * promise about a key rotation that may still be in flight.
   */
  function awaitEcho(signature: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        echoWaiters.delete(signature);
        reject(new Error("The host did not confirm that the commit was stored."));
      }, options.echoTimeoutMs ?? 10_000);
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
      await stores.relay.save({ host: url, fingerprint: null });
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
    await stores.relay.save({ host: url, fingerprint });
    return { ok: true, fingerprint };
  }

  /** Somebody asked to join, so let them in and hand them a copy of the workspace. */
  async function admitDevice(frame: Frame, role: RelayMember["role"]): Promise<void> {
    if (group === null || relay === null) return;

    const payload = decodeBase64(frame.payload);
    if (payload === null) return;

    const current = identity();
    const added = await addDevice(group, decodeKeyPackageBytes(payload));
    await replaceGroup(added.group);

    relay.send(
      signFrame(current.sign, {
        kind: "commit",
        workspaceId,
        deviceId: current.deviceId,
        epoch: added.group.epoch,
        payload: encodeBase64(added.commit),
      }),
    );
    relay.send(
      signFrame(current.sign, {
        kind: "welcome",
        workspaceId,
        deviceId: current.deviceId,
        epoch: added.group.epoch,
        payload: encodeBase64(added.welcome),
      }),
    );

    // The role the invitation granted. Without it the device is in the group but may not
    // write, which reads as a broken workspace rather than a missing step.
    const unsigned = {
      workspaceId,
      deviceId: frame.deviceId,
      role,
      seq: 0,
      signerId: current.deviceId,
    };
    relay.setRole({ ...unsigned, signature: current.sign(roleRecordPayload(unsigned)) });

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
      const committed = await applyCommit(current, payload);
      await replaceGroup(committed.group);
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
      const joined = await joinWorkspaceGroup(payload, pending.identity);
      pending = null;
      await stores.pending.clear();
      await replaceGroup(joined);
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
    const verdict = frameRejection(frame, { workspaceId, epoch: group.epoch });
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
      await replaceGroup(opened.group);
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
   * the evening is one timer, not a busy loop. A policy of `null` leaves the socket closed.
   */
  function scheduleReconnect(): void {
    if (reconnect === null) return;
    if (stopped || hostUrl === null || reconnectTimer !== null) return;
    const base = reconnect.delayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    const ceiling = reconnect.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
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
        if (catchUpOn === "joined") {
          catchUpFrom = null;
          requestCatchUp();
        }
        // Already a member (a first share or a reconnect): hand over a snapshot, because
        // edits made while the socket was down were never published as frames.
        if (group !== null) connectedHandler?.();
      },
      onFrame: (index, frame) => {
        if (!current()) return;
        // The numbered echo says the relay has stored what this device sent, which is what a
        // revoke waits for. It is settled before the frame is applied, because the answer is
        // about the relay's log, not about the local group.
        settleEcho(frame.signature);
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
      onEphemeral: (message) => {
        if (!current()) return;
        options.onEphemeral?.(message);
      },
      onRemoved: () => {
        if (!current()) return;
        removedByOwner = true;
        stopped = true;
        clearReconnect();
        pending = null;
        rejectEchoes(new Error("This device was removed before the commit was confirmed."));
        void stores.pending.clear();
        relay?.close();
        relay = null;
        publishStatus({ state: "removed" });
      },
      onRefused: (reason) => {
        if (!current()) return;
        rejectEchoes(new EchoRefused(reason));
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
        rejectEchoes(new Error("The host went away before it confirmed the commit."));
        publishStatus({ state: "asleep", reason: "the host is not answering" });
        scheduleReconnect();
      },
    };
  }

  async function connectTo(url: string, fingerprint: string | null): Promise<SyncStatus> {
    if (relay !== null) return status;
    stopped = false;
    removedByOwner = false;
    clearReconnect();
    hostUrl = url;
    publishStatus({ state: "connecting" });
    const connection = ++generation;
    try {
      const current = identity();
      const client = await createRelayClient(
        {
          url,
          workspaceId,
          deviceId: current.deviceId,
          publicKey: current.publicKey,
          name: options.deviceName,
          sign: current.sign,
          webSocket: options.webSocket ?? openWebSocket(fingerprint),
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
      if (catchUpOn === "connect") {
        catchUpFrom = null;
        requestCatchUp();
      }
    } catch (error) {
      if (connection !== generation) return status;
      relay = null;
      publishStatus(
        isPinRefusal(error)
          ? { state: "refused", reason: error.message }
          : {
              state: "asleep",
              reason: error instanceof Error ? error.message : "the host is not answering",
            },
      );
      if (!isPinRefusal(error)) scheduleReconnect();
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
  async function share(url: string, fingerprint?: string): Promise<SyncStatus> {
    const pin = await resolvePin(url, fingerprint);
    if (!pin.ok) {
      publishStatus({ state: "refused", reason: pin.reason });
      return status;
    }
    if (group === null) {
      group = await createWorkspaceGroup(
        workspaceId,
        await createDeviceIdentity(options.deviceName),
      );
      await stores.group.save(group);
      await stores.group.markOwned();
      startedHere = true;
      options.onGroupChanged?.();
      await options.onGroupCreated?.({ group, url });
    }
    return connectTo(url, pin.fingerprint);
  }

  return {
    workspaceId,

    status: () => status,

    members: () => members,

    group: () => group,

    hasPendingJoin: () => pending !== null,

    createdHere: () => startedHere,

    async setGroup(next) {
      if (next === null) {
        group = null;
        return;
      }
      await replaceGroup(next);
    },

    client: () => relay,

    hostUrl: () => hostUrl,

    relayFingerprint: () => pinnedFingerprint,

    connect: share,

    async disconnect() {
      stopped = true;
      clearReconnect();
      generation += 1;
      relay?.close();
      relay = null;
      publishStatus({ state: "off" });
    },

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
     * The key package is persisted the moment it is made. An invitation is spent when the
     * relay stores it, so quitting before the welcome would otherwise leave the other
     * person adding a device that never appears.
     */
    async requestJoin(prepared) {
      const pin = await resolvePin(prepared.host, prepared.fingerprint);
      if (!pin.ok) return { ok: false, reason: pin.reason };

      await connectTo(prepared.host, pin.fingerprint);
      if (relay === null) return { ok: true, status };

      const current = identity();
      // The group's credential is the device id, not the name: names are cosmetic and two
      // devices may share one, but removing the wrong device is not a cosmetic mistake.
      const asked = await createDeviceIdentity(current.deviceId);
      pending = { identity: asked, host: prepared.host };
      await stores.pending.save(asked, prepared.host);
      const header = {
        kind: "keypackage" as const,
        workspaceId,
        deviceId: current.deviceId,
        epoch: 0,
        payload: encodeBase64(encodeKeyPackageBytes(asked.keyPackage)),
      };
      relay.sendKeyPackage({
        inviteId: prepared.inviteId,
        deviceId: current.deviceId,
        publicKey: current.publicKey,
        name: options.deviceName,
        frame: signFrame(current.sign, header),
      });
      publishStatus({ state: "waiting" });
      return { ok: true, status };
    },

    publish(update) {
      const work = async (): Promise<void> => {
        if (relay === null || group === null) return;
        const current = identity();
        const sealed = await seal(group, update);
        await replaceGroup(sealed.group);

        const header = {
          kind: "application" as const,
          workspaceId,
          deviceId: current.deviceId,
          epoch: sealed.group.epoch,
          payload: encodeBase64(sealed.message),
        };
        relay.send(signFrame(current.sign, header));
      };
      return serialisePublish ? enqueue(work) : work();
    },

    refuse: (reason) => publishStatus({ state: "refused", reason }),

    refreshStatus: () => publishStatus({ state: "syncing", count: applied() }),

    awaitEcho,

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
