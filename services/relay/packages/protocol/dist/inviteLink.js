import { decodeBase64Url, encodeBase64Url } from "./base64.js";
import { canonicalJson } from "./canonical.js";
import { friendInviteSchema } from "./friendInvite.js";
import { inviteIdSchema, workspaceIdSchema } from "./ids.js";
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
export const INVITE_SCHEME = "suite";
export const JOIN_HOST = "join";
export function formatInvite(details) {
    const query = new URLSearchParams({
        h: details.host,
        w: details.workspaceId,
        i: details.inviteId,
    });
    if (details.friend !== undefined) {
        query.set("e", encodeBase64Url(new TextEncoder().encode(canonicalJson(details.friend))));
    }
    return `${INVITE_SCHEME}://${JOIN_HOST}?${query.toString()}`;
}
/**
 * Read one back.
 *
 * The reasons are written for the person holding the link, because the most likely failure
 * is a half-copied message and "that is not a join link" is the only useful thing to say.
 */
export function parseInvite(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return { ok: false, reason: "Paste a link first." };
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        return { ok: false, reason: "That does not look like a link." };
    }
    if (url.protocol !== `${INVITE_SCHEME}:` || url.hostname !== JOIN_HOST) {
        return { ok: false, reason: "That link is not an invitation to a workspace." };
    }
    const envelope = url.searchParams.get("e");
    if (envelope !== null) {
        const parsed = parseEnvelope(envelope);
        if (!parsed.ok)
            return parsed;
        // A link can carry both forms. They are one invitation, so a disagreement is a
        // damaged message rather than a choice to make.
        const host = url.searchParams.get("h");
        const workspaceId = url.searchParams.get("w");
        const inviteId = url.searchParams.get("i");
        if (host !== null && host !== parsed.value.relay.url)
            return damaged();
        if (workspaceId !== null && workspaceId !== parsed.value.workspace)
            return damaged();
        if (inviteId !== null && inviteId !== parsed.value.invite)
            return damaged();
        return {
            ok: true,
            value: {
                host: parsed.value.relay.url,
                workspaceId: parsed.value.workspace,
                inviteId: parsed.value.invite,
                friend: parsed.value,
            },
        };
    }
    const host = url.searchParams.get("h") ?? "";
    if (!/^wss?:\/\/\S+$/u.test(host)) {
        return { ok: false, reason: "That invitation is missing the address to connect to." };
    }
    const workspaceId = url.searchParams.get("w") ?? "";
    if (!workspaceIdSchema.safeParse(workspaceId).success) {
        return { ok: false, reason: "That invitation is incomplete. Ask for a fresh one." };
    }
    const inviteId = url.searchParams.get("i") ?? "";
    if (!inviteIdSchema.safeParse(inviteId).success) {
        return { ok: false, reason: "That invitation is incomplete. Ask for a fresh one." };
    }
    return { ok: true, value: { host, workspaceId, inviteId } };
}
function parseEnvelope(encoded) {
    const bytes = decodeBase64Url(encoded);
    if (bytes === null)
        return damaged();
    let value;
    try {
        value = JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        return damaged();
    }
    const parsed = friendInviteSchema.safeParse(value);
    if (!parsed.success)
        return damaged();
    return { ok: true, value: parsed.data };
}
function damaged() {
    return { ok: false, reason: "That invitation is damaged. Ask for a fresh one." };
}
//# sourceMappingURL=inviteLink.js.map