import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveFriendCode,
  formatFriendCode,
  friendCodeMatches,
  isFriendCode,
  parseFriendCode,
} from "./friendCode.js";

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
    expect(friendCodeMatches(publicKey(), code)).toBe(false);
    expect(friendCodeMatches(key, "not a code")).toBe(false);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => deriveFriendCode("AAAA")).toThrow(/32 bytes/u);
  });
});
