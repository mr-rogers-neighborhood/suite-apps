import { sha256 } from "@noble/hashes/sha2.js";
import { decodeBase64 } from "./base64.js";

/**
 * A friend code: the one-line name for a device that a person can copy by hand.
 *
 * It is a 70-bit commitment to the installation's Ed25519 public key, followed by a
 * 10-bit checksum, written in Crockford base32. Sixteen symbols total, normally shown
 * as four groups of four. The alphabet leaves out `I`, `L`, `O` and `U`, so `0/O` and
 * `1/I/L` cannot be confused when somebody reads the code out loud or retypes it.
 *
 * A code is an identifier, not a secret: holding one only lets a person ask to be
 * introduced. It is also not reversible, so an app resolves it through its own
 * contacts list rather than by asking a directory.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAYLOAD_SYMBOLS = 14;
const CHECKSUM_SYMBOLS = 2;
const PAYLOAD_BITS = PAYLOAD_SYMBOLS * 5;
const CHECKSUM_BITS = CHECKSUM_SYMBOLS * 5;
const CODE_SYMBOLS = PAYLOAD_SYMBOLS + CHECKSUM_SYMBOLS;

const PAYLOAD_DOMAIN = "suite/friend-code/v1";
const CHECKSUM_DOMAIN = "suite/friend-code-check/v1";

const PUBLIC_KEY_BYTES = 32;

const encoder = new TextEncoder();

/** A code with no separators: sixteen upper-case Crockford symbols. */
export type FriendCode = string;

export type FriendCodeParse =
  | { readonly ok: true; readonly code: FriendCode }
  | { readonly ok: false; readonly reason: string };

/**
 * The code an installation's public key implies.
 *
 * The key arrives as the 32 raw Ed25519 bytes in base64, which is what `identity.json`
 * holds. A key that is not 32 bytes is refused rather than silently hashed: a short or
 * padded key would produce a code nobody else could reproduce.
 */
export function deriveFriendCode(publicKeyBase64: string): FriendCode {
  const bytes = decodeBase64(publicKeyBase64);
  if (bytes === null || bytes.length !== PUBLIC_KEY_BYTES) {
    throw new Error("a friend code needs 32 bytes of base64 Ed25519 public key");
  }
  return codeForBytes(bytes);
}

/** The same derivation, for callers that already hold the raw key bytes. */
export function deriveFriendCodeFromBytes(publicKey: Uint8Array): FriendCode {
  if (publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new Error("a friend code needs 32 bytes of Ed25519 public key");
  }
  return codeForBytes(publicKey);
}

/**
 * Whether a key really is the one a code was made from.
 *
 * A contact stored by code alone is completed by the first signed invitation that
 * arrives: this is the check that decides whether that invitation is the person the
 * code has been waiting for.
 */
export function friendCodeMatches(publicKeyBase64: string, code: string): boolean {
  const parsed = parseFriendCode(code);
  if (!parsed.ok) return false;
  try {
    return deriveFriendCode(publicKeyBase64) === parsed.code;
  } catch {
    return false;
  }
}

/**
 * Read a code a person typed, scanned or pasted.
 *
 * Lower case is accepted because a chat client may change it, and spaces or hyphens
 * are ignored because the display groups the code. Every other symbol must be in the
 * alphabet: `O`, `I` and `L` are refused rather than guessed, because guessing is how
 * a typo becomes somebody else's device.
 */
export function parseFriendCode(text: string): FriendCodeParse {
  const compact = text.replace(/[\s-]/gu, "").toUpperCase();
  if (compact.length === 0) return { ok: false, reason: "Paste or type a friend code first." };
  if (compact.length !== CODE_SYMBOLS) {
    return { ok: false, reason: `A friend code is ${CODE_SYMBOLS} symbols.` };
  }

  const payload = compact.slice(0, PAYLOAD_SYMBOLS);
  for (const symbol of compact) {
    if (!ALPHABET.includes(symbol)) {
      return {
        ok: false,
        reason: `A friend code does not use the symbol ${symbol}. It uses 0-9 and A-Z without I, L, O or U.`,
      };
    }
  }

  const expected = checksumFor(payload);
  if (compact.slice(PAYLOAD_SYMBOLS) !== expected) {
    return {
      ok: false,
      reason: "That friend code has a typo. Check the last two symbols and try again.",
    };
  }
  return { ok: true, code: compact };
}

/** Whether this is a complete code with a matching checksum. */
export function isFriendCode(text: string): text is FriendCode {
  return parseFriendCode(text).ok;
}

/** The display form: four groups of four, which is the 4×4 grid the code is read from. */
export function formatFriendCode(code: FriendCode): string {
  const parsed = parseFriendCode(code);
  if (!parsed.ok) throw new Error(parsed.reason);
  return `${parsed.code.slice(0, 4)}-${parsed.code.slice(4, 8)}-${parsed.code.slice(8, 12)}-${parsed.code.slice(12, 16)}`;
}

function codeForBytes(publicKey: Uint8Array): FriendCode {
  const payload = bitsToSymbols(
    sha256(concat(encoder.encode(PAYLOAD_DOMAIN), publicKey)),
    PAYLOAD_BITS,
  );
  return `${payload}${checksumFor(payload)}`;
}

function checksumFor(payload: string): string {
  return bitsToSymbols(
    sha256(concat(encoder.encode(CHECKSUM_DOMAIN), encoder.encode(payload))),
    CHECKSUM_BITS,
  );
}

/** Read `bitLength` bits, most significant first, as base32 symbols. */
function bitsToSymbols(bytes: Uint8Array, bitLength: number): string {
  let symbols = "";
  for (let at = 0; at < bitLength; at += 5) {
    let value = 0;
    for (let bit = 0; bit < 5; bit += 1) {
      const position = at + bit;
      const byte = bytes[position >> 3] ?? 0;
      value = (value << 1) | ((byte >> (7 - (position & 7))) & 1);
    }
    symbols += ALPHABET.charAt(value);
  }
  return symbols;
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  return joined;
}
