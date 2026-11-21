import { decodeBase64, decodeBase64Url, encodeBase64, encodeBase64Url } from "./base64.js";
import {
  deriveFriendCode,
  type FriendCode,
  formatFriendCode,
  parseFriendCode,
} from "./friendCode.js";

/**
 * A friend code as a link, for a QR or a message.
 *
 * `suite://friend?c=…` is the code alone. The optional `k` carries the inviter's public
 * key, because a hash cannot be reversed: without it, a code-only contact is a promise to
 * be introduced, and the key arrives with the first signed invitation. With it, adding
 * somebody is one scan and the contact is complete on the spot. The public key is public;
 * the code still reveals nothing to anyone who only sees the code.
 */
export const FRIEND_LINK_SCHEME = "suite";
export const FRIEND_LINK_HOST = "friend";

export interface FriendLinkDetails {
  /** The canonical 16-symbol code. */
  readonly code: FriendCode;
  /** Base64 of the 32 raw Ed25519 public-key bytes, when the link carries it. */
  readonly publicKey: string | null;
}

export type FriendLinkParse =
  | { readonly ok: true; readonly value: FriendLinkDetails }
  | { readonly ok: false; readonly reason: string };

export function formatFriendLink(details: FriendLinkDetails): string {
  const parsed = parseFriendCode(details.code);
  if (!parsed.ok) throw new Error(parsed.reason);
  const query = new URLSearchParams({ c: parsed.code });
  if (details.publicKey !== null) {
    const bytes = decodeBase64(details.publicKey);
    if (bytes === null || bytes.length !== 32) {
      throw new Error("a friend link needs a base64 public key");
    }
    if (deriveFriendCode(details.publicKey) !== parsed.code) {
      throw new Error("a friend link's key and code must belong together");
    }
    query.set("k", encodeBase64Url(bytes));
  }
  return `${FRIEND_LINK_SCHEME}://${FRIEND_LINK_HOST}?${query.toString()}`;
}

export function parseFriendLink(text: string): FriendLinkParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Paste or scan a friend code first." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    const code = parseFriendCode(trimmed);
    if (code.ok) return { ok: true, value: { code: code.code, publicKey: null } };
    return { ok: false, reason: "That does not look like a friend code or a link." };
  }

  if (url.protocol !== `${FRIEND_LINK_SCHEME}:` || url.hostname !== FRIEND_LINK_HOST) {
    // A bare code is not a URL either, so this also catches the person who pasted one and
    // the `new URL` above happened to accept it as something else.
    const code = parseFriendCode(trimmed);
    if (code.ok) return { ok: true, value: { code: code.code, publicKey: null } };
    return { ok: false, reason: "That link is not a friend code." };
  }

  const code = parseFriendCode(url.searchParams.get("c") ?? "");
  if (!code.ok) return { ok: false, reason: code.reason };

  const encodedKey = url.searchParams.get("k");
  if (encodedKey === null) return { ok: true, value: { code: code.code, publicKey: null } };

  const bytes = decodeBase64Url(encodedKey);
  if (bytes === null || bytes.length !== 32) {
    return { ok: false, reason: "That friend link has a damaged public key." };
  }
  const publicKey = encodeBase64(bytes);
  if (deriveFriendCode(publicKey) !== code.code) {
    return { ok: false, reason: "That friend link does not match its own code." };
  }
  return { ok: true, value: { code: code.code, publicKey } };
}

/** The display form, for the line under a name. */
export function friendCodeLabel(code: string): string {
  const parsed = parseFriendCode(code);
  return parsed.ok ? formatFriendCode(parsed.code) : code;
}
