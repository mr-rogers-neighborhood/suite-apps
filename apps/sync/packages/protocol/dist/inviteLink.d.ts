import { type FriendInvite } from "./friendInvite.js";
/**
 * The thing one person sends another.
 *
 * A URL rather than an opaque blob: it survives chat clients that mangle punctuation, it
 * can be clicked if anything ever knows how to handle it, and a person can look at it and
 * see it is a join link rather than a password.
 *
 * It carries three facts and no secrets. The invite id is a bearer token — whoever holds the
 * link can ask to join — which is why it expires and why it works once.
 *
 * A new invitation also carries a signed envelope in `e`, naming the inviter's install key
 * and the relay pin. The three legacy fields stay beside it, so an older build still joins
 * and a newer build verifies. A link with no `e` is an old invitation and is read exactly
 * as it always was.
 */
export declare const INVITE_SCHEME = "suite";
export declare const JOIN_HOST = "join";
export interface InviteDetails {
    /** The address of the machine that is carrying the workspace, as `ws://host:port/sync`. */
    readonly host: string;
    readonly workspaceId: string;
    readonly inviteId: string;
    /** The signed envelope, when the invitation was written by a build that has one. */
    readonly friend?: FriendInvite;
}
export type InviteParse = {
    readonly ok: true;
    readonly value: InviteDetails;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function formatInvite(details: InviteDetails): string;
/**
 * Read one back.
 *
 * The reasons are written for the person holding the link, because the most likely failure
 * is a half-copied message and "that is not a join link" is the only useful thing to say.
 */
export declare function parseInvite(text: string): InviteParse;
//# sourceMappingURL=inviteLink.d.ts.map