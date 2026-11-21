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
] as const;

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

export type SuiteSyncStatus = z.infer<typeof suiteSyncStatusSchema>;

/** The role a member holds. Only an owner may invite or revoke. */
export const suiteSyncRoleSchema = z.enum(["owner", "editor", "viewer"]);

export type SuiteSyncRole = z.infer<typeof suiteSyncRoleSchema>;

/** The role an invitation may promise. Ownership is not granted by a link. */
export const suiteSyncInviteRoleSchema = z.enum(["editor", "viewer"]);

export type SuiteSyncInviteRole = z.infer<typeof suiteSyncInviteRoleSchema>;

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

export type SuiteSyncMember = z.infer<typeof suiteSyncMemberSchema>;

/** What a membership notice says changed. Adapters that cannot tell say `roster`. */
export const suiteSyncMembershipChangeSchema = z.enum(["roster", "joined", "left", "role"]);

export type SuiteSyncMembershipChange = z.infer<typeof suiteSyncMembershipChangeSchema>;

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

export type SuiteSyncMembershipNotice = z.infer<typeof suiteSyncMembershipNoticeSchema>;

/**
 * A sealed frame, as the host carries it.
 *
 * The app or pack produced it with its group key. The host may read the protocol's routing
 * header — enough to number and forward it — but not the payload, and it has no key to open.
 */
export type SuiteSyncFrame = Uint8Array;

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

export type SuiteSyncOperation = z.infer<typeof suiteSyncOperationSchema>;

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

export type SuiteSyncErrorCode = z.infer<typeof suiteSyncErrorCodeSchema>;

export const suiteSyncErrorSchema = z
  .object({
    code: suiteSyncErrorCodeSchema,
    operation: suiteSyncOperationSchema,
    message: z.string().min(1),
  })
  .strict();

export type SuiteSyncError = z.infer<typeof suiteSyncErrorSchema>;

/**
 * A failure a caller can catch and show.
 *
 * The class exists so an adapter can throw a shaped failure rather than a bare `Error`; the
 * schema is the same value after it has crossed a process boundary.
 */
export class SuiteSyncCapabilityError extends Error implements SuiteSyncError {
  readonly code: SuiteSyncErrorCode;
  readonly operation: SuiteSyncOperation;

  constructor(operation: SuiteSyncOperation, code: SuiteSyncErrorCode, message: string) {
    super(message);
    this.name = "SuiteSyncCapabilityError";
    this.operation = operation;
    this.code = code;
  }

  toJSON(): SuiteSyncError {
    return { code: this.code, operation: this.operation, message: this.message };
  }
}

/**
 * The host's surface for one workspace.
 *
 * `enable` takes the workspace id explicitly rather than reading one from the host's open
 * document. That is what lets the same host serve a pack, whose document the host cannot read.
 * The id is the sync identity the document already owns, never a key.
 *
 * `send` and `onFrame` are the sealed-frame channel. The bytes are already sealed when a pack
 * is the caller; an implementation that owns the group key seals on entry and opens on exit,
 * and either way no frame reaches a host unsealed. Membership notices travel beside the frames,
 * because the roster is readable metadata while the frames are not.
 */
export interface SuiteSyncCapability {
  /** What sync is doing now, without opening a socket or asking a question. */
  status(): Promise<SuiteSyncStatus>;

  /** Start syncing `workspaceId` through `relayUrl`, or reconnect to it. */
  enable(workspaceId: string, relayUrl: string): Promise<SuiteSyncStatus>;

  /** Stop syncing this copy. The document, the group and the membership stay. */
  disable(): Promise<SuiteSyncStatus>;

  /** Write one single-use invitation and return the link to give somebody. */
  invite(role: SuiteSyncInviteRole): Promise<string>;

  /** Ask to join from a link somebody shared. */
  join(link: string): Promise<SuiteSyncStatus>;

  /** Who the readable membership metadata names, as the host last said. */
  members(): Promise<readonly SuiteSyncMember[]>;

  /** Hand one sealed frame to the host. The host stores and forwards it, never opens it. */
  send(frame: SuiteSyncFrame): Promise<void>;

  /** Take one sealed frame the host delivered, in the order the host stored it. */
  onFrame(listener: (frame: SuiteSyncFrame) => void): () => void;

  /** Act on a roster change. No document text travels with it. */
  onMembership(listener: (notice: SuiteSyncMembershipNotice) => void): () => void;
}
