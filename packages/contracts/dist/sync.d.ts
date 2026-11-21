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
export declare const SUITE_SYNC_STATUSES: readonly ["off", "connecting", "syncing", "asleep", "refused", "waiting", "removed"];
/**
 * What sync is doing, as one value.
 *
 * `syncing.count` is the host's frame count when this device joined. It is a liveness signal,
 * not a document version: a host's numbering is about its log, not about what the document
 * contains. `waiting` means a join was asked for and the welcome has not arrived; `removed`
 * means an owner decided this device is out, which is not a failure to retry.
 */
export declare const suiteSyncStatusSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    state: z.ZodLiteral<"off">;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"connecting">;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"syncing">;
    count: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"asleep">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"refused">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"waiting">;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodLiteral<"removed">;
}, z.core.$strict>], "state">;
export type SuiteSyncStatus = z.infer<typeof suiteSyncStatusSchema>;
/** The role a member holds. Only an owner may invite or revoke. */
export declare const suiteSyncRoleSchema: z.ZodEnum<{
    owner: "owner";
    editor: "editor";
    viewer: "viewer";
}>;
export type SuiteSyncRole = z.infer<typeof suiteSyncRoleSchema>;
/** The role an invitation may promise. Ownership is not granted by a link. */
export declare const suiteSyncInviteRoleSchema: z.ZodEnum<{
    editor: "editor";
    viewer: "viewer";
}>;
export type SuiteSyncInviteRole = z.infer<typeof suiteSyncInviteRoleSchema>;
/**
 * One device the host's readable metadata names.
 *
 * A device id is a fingerprint, not a secret: the host already pins it at join. A name and a
 * role are the only parts a person sees, because "which device may write" is a question a hex
 * string cannot answer.
 */
export declare const suiteSyncMemberSchema: z.ZodObject<{
    deviceId: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
}, z.core.$strict>;
export type SuiteSyncMember = z.infer<typeof suiteSyncMemberSchema>;
/** What a membership notice says changed. Adapters that cannot tell say `roster`. */
export declare const suiteSyncMembershipChangeSchema: z.ZodEnum<{
    role: "role";
    roster: "roster";
    joined: "joined";
    left: "left";
}>;
export type SuiteSyncMembershipChange = z.infer<typeof suiteSyncMembershipChangeSchema>;
/**
 * A readable membership change.
 *
 * The whole roster travels with the notice rather than a delta. It is small, it is already
 * public, and a consumer that missed one notice is still correct after the next one.
 */
export declare const suiteSyncMembershipNoticeSchema: z.ZodObject<{
    change: z.ZodEnum<{
        role: "role";
        roster: "roster";
        joined: "joined";
        left: "left";
    }>;
    members: z.ZodArray<z.ZodObject<{
        deviceId: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SuiteSyncMembershipNotice = z.infer<typeof suiteSyncMembershipNoticeSchema>;
/**
 * A sealed frame, as the host carries it.
 *
 * The app or pack produced it with its group key. The host may read the protocol's routing
 * header — enough to number and forward it — but not the payload, and it has no key to open.
 */
export type SuiteSyncFrame = Uint8Array;
/** What a caller was asking for when it failed. A document is never the answer. */
export declare const suiteSyncOperationSchema: z.ZodEnum<{
    join: "join";
    members: "members";
    status: "status";
    enable: "enable";
    disable: "disable";
    invite: "invite";
    send: "send";
}>;
export type SuiteSyncOperation = z.infer<typeof suiteSyncOperationSchema>;
/**
 * Why a call failed, named by the work rather than by what the work was holding.
 *
 * `code` is for a program; `message` is for a person and names the next action. Neither may
 * carry document text, a key, or a workspace's contents — the failure is about the connection
 * or the invitation, and saying more would leak what the boundary exists to protect.
 */
export declare const suiteSyncErrorCodeSchema: z.ZodEnum<{
    unknown: "unknown";
    refused: "refused";
    removed: "removed";
    "no-workspace": "no-workspace";
    "bad-relay": "bad-relay";
    "wrong-workspace": "wrong-workspace";
    "not-connected": "not-connected";
    "bad-link": "bad-link";
    "not-owner": "not-owner";
    "already-member": "already-member";
    unreachable: "unreachable";
}>;
export type SuiteSyncErrorCode = z.infer<typeof suiteSyncErrorCodeSchema>;
export declare const suiteSyncErrorSchema: z.ZodObject<{
    code: z.ZodEnum<{
        unknown: "unknown";
        refused: "refused";
        removed: "removed";
        "no-workspace": "no-workspace";
        "bad-relay": "bad-relay";
        "wrong-workspace": "wrong-workspace";
        "not-connected": "not-connected";
        "bad-link": "bad-link";
        "not-owner": "not-owner";
        "already-member": "already-member";
        unreachable: "unreachable";
    }>;
    operation: z.ZodEnum<{
        join: "join";
        members: "members";
        status: "status";
        enable: "enable";
        disable: "disable";
        invite: "invite";
        send: "send";
    }>;
    message: z.ZodString;
}, z.core.$strict>;
export type SuiteSyncError = z.infer<typeof suiteSyncErrorSchema>;
/**
 * A failure a caller can catch and show.
 *
 * The class exists so an adapter can throw a shaped failure rather than a bare `Error`; the
 * schema is the same value after it has crossed a process boundary.
 */
export declare class SuiteSyncCapabilityError extends Error implements SuiteSyncError {
    readonly code: SuiteSyncErrorCode;
    readonly operation: SuiteSyncOperation;
    constructor(operation: SuiteSyncOperation, code: SuiteSyncErrorCode, message: string);
    toJSON(): SuiteSyncError;
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
//# sourceMappingURL=sync.d.ts.map