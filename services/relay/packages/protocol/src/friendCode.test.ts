import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveFriendCode,
  deriveFriendCodeFromBytes,
  formatFriendCode,
  friendCodeMatches,
  isFriendCode,
  parseFriendCode,
} from "./friendCode.js";

/**
 * Fixed keys and the code each must produce.
 *
 * These pin the derivation, not just its shape: a change to the domain string, the bit
 * order or the truncation would still yield sixteen plausible symbols, and only a vector
 * catches that.
 */
const VECTORS = [
  {
    name: "the byte sequence 00..1f",
    publicKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    code: "49AD1CD0E5G07PAC",
  },
  {
    name: "an all-zero key",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    code: "MG32Z76KPZS33C55",
  },
  {
    name: "an all-ones key",
    publicKey: "//////////////////////////////////////////8=",
    code: "2DJ40MTRJFRPNPDG",
  },
] as const;

function publicKey(): string {
  const { publicKey: key } = generateKeyPairSync("ed25519");
  return key.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
}

describe("a friend code", () => {
  it("is sixteen Crockford symbols, and the same for the same device", () => {
    const key = publicKey();
    const code = deriveFriendCode(key);

    expect(code).toHaveLength(16);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/u);
    expect(deriveFriendCode(key)).toBe(code);
    expect(isFriendCode(code)).toBe(true);
  });

  it("is different for a different device", () => {
    expect(deriveFriendCode(publicKey())).not.toBe(deriveFriendCode(publicKey()));
  });

  it("matches the fixed vectors for a known key", () => {
    for (const vector of VECTORS) {
      expect(deriveFriendCode(vector.publicKey)).toBe(vector.code);
      expect(deriveFriendCodeFromBytes(Buffer.from(vector.publicKey, "base64"))).toBe(vector.code);
      expect(formatFriendCode(vector.code)).toBe(
        `${vector.code.slice(0, 4)}-${vector.code.slice(4, 8)}-${vector.code.slice(8, 12)}-${vector.code.slice(12, 16)}`,
      );
    }
  });

  it("reads back from the way it is displayed", () => {
    const code = deriveFriendCode(publicKey());
    const display = formatFriendCode(code);
    expect(display).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/u);
    expect(parseFriendCode(display)).toEqual({ ok: true, code });
  });

  it("ignores spaces, hyphens and lower case, which a chat client adds", () => {
    const code = deriveFriendCode(publicKey());
    expect(parseFriendCode(` ${formatFriendCode(code).toLowerCase()}\n`)).toEqual({
      ok: true,
      code,
    });
  });

  it("refuses a code with a changed checksum", () => {
    const code = deriveFriendCode(publicKey());
    const wrong = `${code.slice(0, 15)}${code.endsWith("0") ? "1" : "0"}`;
    expect(parseFriendCode(wrong)).toMatchObject({ ok: false });
    expect(parseFriendCode(wrong)).toMatchObject({ reason: expect.stringMatching(/typo/u) });
  });

  it("refuses a payload whose checksum belongs to the unedited code", () => {
    const code = "49AD1CD0E5G07PAC";
    const changed = `${code[0] === "0" ? "1" : "0"}${code.slice(1)}`;
    expect(parseFriendCode(changed)).toEqual({
      ok: false,
      reason: "That friend code has a typo. Check the last two symbols and try again.",
    });
  });

  it("refuses a symbol the alphabet does not have", () => {
    const code = deriveFriendCode(publicKey());
    for (const symbol of ["!", "$", ".", "_", "="]) {
      const typed = `${code.slice(0, 4)}${symbol}${code.slice(5)}`;
      const parsed = parseFriendCode(typed);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toContain(`does not use the symbol ${symbol}`);
    }
  });

  it("asks for a code when the text is only separators or whitespace", () => {
    for (const text of ["", "   ", "\n\t", "- - - -", "----"]) {
      expect(parseFriendCode(text)).toEqual({
        ok: false,
        reason: "Paste or type a friend code first.",
      });
    }
  });

  it("refuses a code that is too long as well as one that is too short", () => {
    const code = deriveFriendCode(publicKey());
    for (const text of [code.slice(0, 15), `${code}A`]) {
      expect(parseFriendCode(text)).toEqual({
        ok: false,
        reason: "A friend code is 16 symbols.",
      });
    }
  });

  it("refuses the ambiguous letters the alphabet leaves out", () => {
    const code = deriveFriendCode(publicKey());
    for (const symbol of ["O", "I", "L", "U"]) {
      const typed = `${symbol}${code.slice(1)}`;
      expect(parseFriendCode(typed)).toMatchObject({ ok: false });
      expect(parseFriendCode(typed)).toMatchObject({
        reason: expect.stringMatching(new RegExp(`does not use the symbol ${symbol}`, "u")),
      });
    }
  });

  it("asks for the full length rather than guessing", () => {
    expect(parseFriendCode("")).toMatchObject({ ok: false });
    expect(parseFriendCode("ABCD")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/16 symbols/u),
    });
  });

  it("tells whether a key really is the one the code names", () => {
    const key = publicKey();
    const code = deriveFriendCode(key);
    expect(friendCodeMatches(key, code)).toBe(true);
    expect(friendCodeMatches(key, formatFriendCode(code))).toBe(true);
    expect(friendCodeMatches(publicKey(), code)).toBe(false);
    expect(friendCodeMatches(key, "not a code")).toBe(false);
    expect(friendCodeMatches("not a key", code)).toBe(false);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => deriveFriendCode("AAAA")).toThrow(/32 bytes/u);
    expect(() => deriveFriendCode("not base64!")).toThrow(/32 bytes/u);
    expect(() => deriveFriendCodeFromBytes(new Uint8Array(31))).toThrow(/32 bytes/u);
    expect(() => deriveFriendCodeFromBytes(new Uint8Array(33))).toThrow(/32 bytes/u);
  });

  it("refuses to format something that is not a code", () => {
    expect(() => formatFriendCode("49AD-1CD0-E5G0-7PA")).toThrow(/16 symbols/u);
    expect(() => formatFriendCode("49AD1CD0E5G07PAA")).toThrow(/typo/u);
  });
});
