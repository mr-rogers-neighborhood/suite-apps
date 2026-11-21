import { z } from "zod";
/**
 * `suite.sync` — the capability a host provides to an app or pack.
 *
 * The boundary is the whole point of this module. The app or pack owns the document and the
 * group keys: it seals an update before the host can see it and opens a frame after the host
 * has moved it. The host owns the socket, the relay address and the readable membership
 * metadata, and it never holds a key that could open a frame.
 *
 * So there are exactly two things on the wire here: opaque sealed frames and the roster the
 * protocol already treats as public (device ids, names, roles). No document text, no schema,
 * no plaintext payload and no key appears in either.
 *
 * This is a contract, not a service. Planner and Canvas implement it in their main processes
 * today over the sync service they already have; a host can implement the same surface later
 * without either app changing its UI or its document layer.
 */
/** Every state a person can be shown, in the words a person can act on. */
export const SUITE_SYNC_STATUSES = [
    "off",
    "connecting",
    "syncing",
    "asleep",
    "refused",
    "waiting",
    "removed",
];
/**
 * What sync is doing, as one value.
 *
 * `syncing.count` is the host's frame count when this device joined. It is a liveness signal,
 * not a document version: a host's numbering is about its log, not about what the document
 * contains. `waiting` means a join was asked for and the welcome has not arrived; `removed`
 * means an owner decided this device is out, which is not a failure to retry.
 */
export const suiteSyncStatusSchema = z.discriminatedUnion("state", [
    z.object({ state: z.literal("off") }).strict(),
    z.object({ state: z.literal("connecting") }).strict(),
    z
        .object({
        state: z.literal("syncing"),
        count: z.number().int().nonnegative(),
    })
        .strict(),
    z.object({ state: z.literal("asleep"), reason: z.string().min(1) }).strict(),
    z.object({ state: z.literal("refused"), reason: z.string().min(1) }).strict(),
    z.object({ state: z.literal("waiting") }).strict(),
    z.object({ state: z.literal("removed") }).strict(),
]);
/** The role a member holds. Only an owner may invite or revoke. */
export const suiteSyncRoleSchema = z.enum(["owner", "editor", "viewer"]);
/** The role an invitation may promise. Ownership is not granted by a link. */
export const suiteSyncInviteRoleSchema = z.enum(["editor", "viewer"]);
/**
 * One device the host's readable metadata names.
 *
 * A device id is a fingerprint, not a secret: the host already pins it at join. A name and a
 * role are the only parts a person sees, because "which device may write" is a question a hex
 * string cannot answer.
 */
export const suiteSyncMemberSchema = z
    .object({
    deviceId: z.string().min(1),
    name: z.string().min(1),
    role: suiteSyncRoleSchema,
})
    .strict();
/** What a membership notice says changed. Adapters that cannot tell say `roster`. */
export const suiteSyncMembershipChangeSchema = z.enum(["roster", "joined", "left", "role"]);
/**
 * A readable membership change.
 *
 * The whole roster travels with the notice rather than a delta. It is small, it is already
 * public, and a consumer that missed one notice is still correct after the next one.
 */
export const suiteSyncMembershipNoticeSchema = z
    .object({
    change: suiteSyncMembershipChangeSchema,
    members: z.array(suiteSyncMemberSchema),
})
    .strict();
/** What a caller was asking for when it failed. A document is never the answer. */
export const suiteSyncOperationSchema = z.enum([
    "status",
    "enable",
    "disable",
    "invite",
    "join",
    "send",
    "members",
]);
/**
 * Why a call failed, named by the work rather than by what the work was holding.
 *
 * `code` is for a program; `message` is for a person and names the next action. Neither may
 * carry document text, a key, or a workspace's contents — the failure is about the connection
 * or the invitation, and saying more would leak what the boundary exists to protect.
 */
export const suiteSyncErrorCodeSchema = z.enum([
    "no-workspace",
    "bad-relay",
    "wrong-workspace",
    "not-connected",
    "bad-link",
    "not-owner",
    "already-member",
    "refused",
    "removed",
    "unreachable",
    "unknown",
]);
export const suiteSyncErrorSchema = z
    .object({
    code: suiteSyncErrorCodeSchema,
    operation: suiteSyncOperationSchema,
    message: z.string().min(1),
})
    .strict();
/**
 * A failure a caller can catch and show.
 *
 * The class exists so an adapter can throw a shaped failure rather than a bare `Error`; the
 * schema is the same value after it has crossed a process boundary.
 */
export class SuiteSyncCapabilityError extends Error {
    code;
    operation;
    constructor(operation, code, message) {
        super(message);
        this.name = "SuiteSyncCapabilityError";
        this.operation = operation;
        this.code = code;
    }
    toJSON() {
        return { code: this.code, operation: this.operation, message: this.message };
    }
}
//# sourceMappingURL=sync.js.map