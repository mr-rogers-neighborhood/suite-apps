import {
  type Frame,
  type FrameKind,
  type FrameRejection,
  framePayload,
  hostAcceptsEpoch,
  mayWrite,
  type RoleState,
  type SealedFrame,
} from "@suite/sync";
import type { StoredFrame } from "./store.js";

/**
 * What a host is allowed to decide, and the only things it is allowed to decide.
 *
 * A blind host orders frames, stores them and hands them on. It cannot read one, cannot
 * merge two, and cannot tell whether the document inside is well formed. So its whole
 * authority is four refusals: the wrong workspace, an epoch it has already passed (except
 * for a key package, which is the join request), a sender with no role, and a signature
 * that does not verify.
 *
 * Everything else is the clients' business. This module exists so those four refusals
 * are testable without a socket, and so the socket layer has nothing to decide.
 */
export type HostRejection = FrameRejection;

export type HostVerdict =
  | { readonly ok: true; readonly frame: Frame }
  | { readonly ok: false; readonly reason: HostRejection };

/** Verifies a frame's signature against a public key the host pinned for that device. */
export type FrameVerifier = (payload: Uint8Array, signature: string, publicKey: string) => boolean;

export interface HostWorkspace {
  readonly workspaceId: string;
  /** The newest epoch this host has stored a frame for. */
  readonly newestEpoch: number | null;
}

/**
 * Decide whether to store one frame.
 *
 * The order matters: the workspace and the epoch are cheap and unambiguous, the role
 * record is next, and the signature is last because it is the most expensive. A frame
 * is only stored when all four agree.
 *
 * A key package is the one kind that skips the epoch floor. It carries `0` because a
 * device with no group has no epoch, and it is a request to join rather than a message
 * in the group's ordering; measuring it against `newestEpoch` would refuse every device
 * that asks to join a workspace that has already moved. It still has to be signed by the
 * key it claims, and a live invitation still makes it safe.
 */
export interface AdmitOptions {
  /**
   * A frame kind that may come from a device with no role.
   *
   * There is exactly one caller: a key package, which is how a device asks to join. A live
   * invite is what makes it safe, and the invite is checked before this is reached.
   */
  readonly kindAllowedWithoutRole?: FrameKind;
}

export function admitFrame(
  sealed: SealedFrame,
  host: HostWorkspace,
  roles: RoleState,
  keyOf: (deviceId: string) => string | null,
  verify: FrameVerifier,
  receivedAt: string = new Date().toISOString(),
  admitOptions: AdmitOptions = {},
): HostVerdict {
  if (sealed.workspaceId !== host.workspaceId) return { ok: false, reason: "wrong-workspace" };

  // The join request is exempt from the epoch floor, and nothing else is: a key package
  // is not group traffic and cannot carry a meaningful epoch.
  const joinRequest = sealed.kind === "keypackage";
  if (!joinRequest && !hostAcceptsEpoch(sealed.epoch, host.newestEpoch))
    return { ok: false, reason: "stale-epoch" };

  const invited = admitOptions.kindAllowedWithoutRole === sealed.kind;
  if (!invited && !mayWrite(roles, sealed.deviceId)) return { ok: false, reason: "not-authorized" };

  const publicKey = keyOf(sealed.deviceId);
  if (publicKey === null || !verify(framePayload(sealed), sealed.signature, publicKey)) {
    return { ok: false, reason: "invalid-signature" };
  }

  return { ok: true, frame: { ...sealed, receivedAt } };
}

/**
 * The frames one workspace has, oldest first, each with the position it was given.
 *
 * Held in memory and persisted by whatever writes them out. The host may drop the oldest
 * when a retention window closes; it cannot compact them, because compaction is reading.
 * Dropping never renumbers what stays, so a cursor a client already holds still means the
 * same frame after the window moves.
 */
export class FrameLog {
  readonly workspaceId: string;
  private readonly entries: StoredFrame[] = [];
  private next = 0;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /**
   * Put back what a store held across a restart.
   *
   * `nextIndex` is the store's durable position, not a count: a log that was compacted to
   * empty still starts where it left off.
   */
  restore(entries: readonly StoredFrame[], nextIndex: number): void {
    this.entries.length = 0;
    this.entries.push(...entries);
    let next = nextIndex;
    for (const entry of entries) next = Math.max(next, entry.index + 1);
    this.next = next;
  }

  get length(): number {
    return this.entries.length;
  }

  /**
   * The oldest position this log can serve.
   *
   * When nothing is held it is the position the next frame will take, so a cursor below it
   * still reads as a gap rather than an empty catch-up.
   */
  get oldestIndex(): number {
    return this.entries[0]?.index ?? this.next;
  }

  /** The position the next frame will take. */
  get nextIndex(): number {
    return this.next;
  }

  /** The newest epoch stored, which is the one a later frame is measured against. */
  get newestEpoch(): number | null {
    let newest: number | null = null;
    for (const entry of this.entries) {
      if (newest === null || entry.frame.epoch > newest) newest = entry.frame.epoch;
    }
    return newest;
  }

  append(frame: Frame): StoredFrame {
    const entry = { index: this.next, frame };
    this.next += 1;
    this.entries.push(entry);
    return entry;
  }

  all(): readonly StoredFrame[] {
    return this.entries;
  }

  /** Frames from `after` onward, by the position the host stored with each one. */
  since(after: number): readonly StoredFrame[] {
    return this.entries.filter((entry) => entry.index >= after);
  }

  /**
   * Whether a cursor predates what retention still holds.
   *
   * `after` is the first position the client is asking for, so it is a gap exactly when
   * that position is older than the oldest this log can serve.
   */
  hasGap(after: number): boolean {
    return after < this.oldestIndex;
  }

  /**
   * Forget frames that arrived before a cutoff.
   *
   * This is the retention window. A device away longer than this cannot replay its way
   * back in — it needs a snapshot from a peer, because the host cannot hand out a document
   * it was never able to read.
   */
  dropOlderThan(cutoff: string): number {
    const kept = this.entries.filter((entry) => entry.frame.receivedAt >= cutoff);
    const dropped = this.entries.length - kept.length;
    this.entries.length = 0;
    this.entries.push(...kept);
    return dropped;
  }

  /** Forget everything older than `epoch`. The host may not keep what it cannot read. */
  dropBefore(epoch: number): number {
    const kept = this.entries.filter((entry) => entry.frame.epoch >= epoch);
    const dropped = this.entries.length - kept.length;
    this.entries.length = 0;
    this.entries.push(...kept);
    return dropped;
  }
}
