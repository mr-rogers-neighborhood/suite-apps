import { framePayload, hostAcceptsEpoch, mayWrite, } from "@suite/sync";
export function admitFrame(sealed, host, roles, keyOf, verify, receivedAt = new Date().toISOString(), admitOptions = {}) {
    if (sealed.workspaceId !== host.workspaceId)
        return { ok: false, reason: "wrong-workspace" };
    // The join request is exempt from the epoch floor, and nothing else is: a key package
    // is not group traffic and cannot carry a meaningful epoch.
    const joinRequest = sealed.kind === "keypackage";
    if (!joinRequest && !hostAcceptsEpoch(sealed.epoch, host.newestEpoch))
        return { ok: false, reason: "stale-epoch" };
    const invited = admitOptions.kindAllowedWithoutRole === sealed.kind;
    if (!invited && !mayWrite(roles, sealed.deviceId))
        return { ok: false, reason: "not-authorized" };
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
    workspaceId;
    entries = [];
    next = 0;
    constructor(workspaceId) {
        this.workspaceId = workspaceId;
    }
    /**
     * Put back what a store held across a restart.
     *
     * `nextIndex` is the store's durable position, not a count: a log that was compacted to
     * empty still starts where it left off.
     */
    restore(entries, nextIndex) {
        this.entries.length = 0;
        this.entries.push(...entries);
        let next = nextIndex;
        for (const entry of entries)
            next = Math.max(next, entry.index + 1);
        this.next = next;
    }
    get length() {
        return this.entries.length;
    }
    /**
     * The oldest position this log can serve.
     *
     * When nothing is held it is the position the next frame will take, so a cursor below it
     * still reads as a gap rather than an empty catch-up.
     */
    get oldestIndex() {
        return this.entries[0]?.index ?? this.next;
    }
    /** The position the next frame will take. */
    get nextIndex() {
        return this.next;
    }
    /** The newest epoch stored, which is the one a later frame is measured against. */
    get newestEpoch() {
        let newest = null;
        for (const entry of this.entries) {
            if (newest === null || entry.frame.epoch > newest)
                newest = entry.frame.epoch;
        }
        return newest;
    }
    append(frame) {
        const entry = { index: this.next, frame };
        this.next += 1;
        this.entries.push(entry);
        return entry;
    }
    all() {
        return this.entries;
    }
    /** Frames from `after` onward, by the position the host stored with each one. */
    since(after) {
        return this.entries.filter((entry) => entry.index >= after);
    }
    /**
     * Whether a cursor predates what retention still holds.
     *
     * `after` is the first position the client is asking for, so it is a gap exactly when
     * that position is older than the oldest this log can serve.
     */
    hasGap(after) {
        return after < this.oldestIndex;
    }
    /**
     * Forget frames that arrived before a cutoff.
     *
     * This is the retention window. A device away longer than this cannot replay its way
     * back in — it needs a snapshot from a peer, because the host cannot hand out a document
     * it was never able to read.
     */
    dropOlderThan(cutoff) {
        const kept = this.entries.filter((entry) => entry.frame.receivedAt >= cutoff);
        const dropped = this.entries.length - kept.length;
        this.entries.length = 0;
        this.entries.push(...kept);
        return dropped;
    }
    /** Forget everything older than `epoch`. The host may not keep what it cannot read. */
    dropBefore(epoch) {
        const kept = this.entries.filter((entry) => entry.frame.epoch >= epoch);
        const dropped = this.entries.length - kept.length;
        this.entries.length = 0;
        this.entries.push(...kept);
        return dropped;
    }
}
//# sourceMappingURL=blindRoom.js.map