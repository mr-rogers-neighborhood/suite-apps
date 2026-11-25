import { normaliseFingerprint } from "./fingerprint.js";
import { inviteIdSchema, workspaceIdSchema } from "./ids.js";

/**
 * The payload a future phone scans to meet a relay.
 *
 * It is a URL for the same reasons an invitation is: it survives chat clients, it
 * is one line, and a person can see what kind of thing it is. Three facts travel
 * here — where the relay is, the certificate to pin, and an invitation when the
 * owner has one to give. The fingerprint is not a secret; it is the trust root a
 * self-signed relay has instead of a certificate authority.
 *
 * `f` is required for `wss://`: a pinned relay without its pin is a connection
 * that cannot make the decision the pin exists for. A loopback `ws://` relay
 * carries no certificate, so `f` may be absent there; if one is present anyway,
 * a client that knows the scheme is plaintext ignores it.
 *
 * `w` and `i` travel together. An invitation id alone names no workspace, and a
 * workspace alone is not an invitation.
 */
export const RELAY_LINK_SCHEME = "suite";
export const RELAY_LINK_HOST = "relay";

export interface RelayLinkDetails {
  /** The relay's WebSocket address, `ws://` or `wss://`, ending in `/sync`. */
  readonly url: string;
  /** The SHA-256 certificate fingerprint, when the relay serves TLS. */
  readonly fingerprint: string | null;
  /** The workspace an optional invitation is for. */
  readonly workspaceId: string | null;
  /** A bearer invitation token, when the owner put one in this payload. */
  readonly inviteId: string | null;
}

export type RelayLinkParse =
  | { readonly ok: true; readonly value: RelayLinkDetails }
  | { readonly ok: false; readonly reason: string };

export function formatRelayLink(details: RelayLinkDetails): string {
  const query = new URLSearchParams({ u: details.url });
  if (details.fingerprint !== null) query.set("f", details.fingerprint);
  if (details.workspaceId !== null && details.inviteId !== null) {
    query.set("w", details.workspaceId);
    query.set("i", details.inviteId);
  }
  return `${RELAY_LINK_SCHEME}://${RELAY_LINK_HOST}?${query.toString()}`;
}

export function parseRelayLink(text: string): RelayLinkParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Scan a relay code first." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That does not look like a relay code." };
  }

  if (url.protocol !== `${RELAY_LINK_SCHEME}:` || url.hostname !== RELAY_LINK_HOST) {
    return { ok: false, reason: "That code is not for a Suite relay." };
  }

  const relayUrl = url.searchParams.get("u") ?? "";
  if (!/^wss?:\/\/\S+$/u.test(relayUrl)) {
    return { ok: false, reason: "That relay code is missing the address to connect to." };
  }
  const secure = relayUrl.startsWith("wss://");

  const rawFingerprint = url.searchParams.get("f");
  const fingerprint = rawFingerprint === null ? null : normaliseFingerprint(rawFingerprint);
  if (rawFingerprint !== null && fingerprint === null) {
    return { ok: false, reason: "That relay code has a malformed certificate fingerprint." };
  }
  if (secure && fingerprint === null) {
    return {
      ok: false,
      reason: "That relay code is for wss:// but carries no certificate fingerprint.",
    };
  }

  const workspaceId = url.searchParams.get("w");
  const inviteId = url.searchParams.get("i");
  if ((workspaceId === null) !== (inviteId === null)) {
    return { ok: false, reason: "That relay code has half an invitation. Ask for a fresh one." };
  }
  if (workspaceId !== null && !workspaceIdSchema.safeParse(workspaceId).success) {
    return { ok: false, reason: "That relay code names a workspace that is not an id." };
  }
  if (inviteId !== null && !inviteIdSchema.safeParse(inviteId).success) {
    return { ok: false, reason: "That relay code has a malformed invitation." };
  }

  return { ok: true, value: { url: relayUrl, fingerprint, workspaceId, inviteId } };
}
