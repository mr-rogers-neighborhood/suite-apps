import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveFriendCode, formatFriendCode, parseFriendCode } from "./friendCode.js";
import { formatFriendLink, parseContactInput, parseFriendLink } from "./friendLink.js";

function publicKey(): string {
  const { publicKey: key } = generateKeyPairSync("ed25519");
  return key.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
}

describe("a friend link", () => {
  it("carries the code alone when there is no key", () => {
    const code = deriveFriendCode(publicKey());
    expect(parseFriendLink(formatFriendLink({ code, publicKey: null }))).toEqual({
      ok: true,
      value: { code, publicKey: null },
    });
  });

  it("carries the public key too, so a scan completes the contact", () => {
    const key = publicKey();
    const code = deriveFriendCode(key);
    const parsed = parseFriendLink(formatFriendLink({ code, publicKey: key }));
    expect(parsed).toEqual({ ok: true, value: { code, publicKey: key } });
  });

  it("reads a bare code a person pasted instead of a link", () => {
    const code = deriveFriendCode(publicKey());
    expect(parseFriendLink(` ${code} `)).toEqual({ ok: true, value: { code, publicKey: null } });
  });

  it("refuses a key that does not hash to the code in the same link", () => {
    const code = deriveFriendCode(publicKey());
    const other = publicKey();
    expect(() => formatFriendLink({ code, publicKey: other })).toThrow(/belong together/u);

    // A hand-edited link bypasses the formatter; the parser must still refuse it.
    const bytes = Buffer.from(other, "base64").toString("base64url");
    const link = `suite://friend?c=${code}&k=${bytes}`;
    expect(parseFriendLink(link)).toEqual({
      ok: false,
      reason: "That friend link does not match its own code.",
    });
  });

  it("reads a link and a bare code as the same contact value", () => {
    const key = publicKey();
    const code = deriveFriendCode(key);
    const link = formatFriendLink({ code, publicKey: key });
    const fromLink = parseContactInput(link);
    const fromCode = parseContactInput(formatFriendCode(code));
    expect(fromLink).toEqual({ ok: true, value: { code, publicKey: key } });
    expect(fromCode).toEqual({ ok: true, value: { code, publicKey: null } });
    // Round trip: the parsed value writes the same link a scan would carry.
    if (!fromLink.ok) throw new Error(fromLink.reason);
    expect(formatFriendLink(fromLink.value)).toBe(link);
    if (!fromCode.ok) throw new Error(fromCode.reason);
    expect(formatFriendLink(fromCode.value)).toBe(formatFriendLink({ code, publicKey: null }));
  });

  it("refuses a malformed link with the reason a malformed code gets", () => {
    const short = parseFriendCode("ABC");
    if (short.ok) throw new Error("ABC is not a friend code");
    expect(parseContactInput("suite://friend?c=ABC")).toEqual({ ok: false, reason: short.reason });
    expect(parseContactInput("ABC")).toEqual({ ok: false, reason: short.reason });
    expect(parseContactInput("https://example.com/friend")).toMatchObject({ ok: false });
    expect(parseContactInput("   ")).toEqual({
      ok: false,
      reason: "Paste or type a friend code first.",
    });
  });

  it("refuses another scheme, a bad code and a damaged key", () => {
    expect(parseFriendLink("https://example.com/friend")).toMatchObject({ ok: false });
    expect(parseFriendLink("suite://friend?c=ABC")).toMatchObject({ ok: false });
    expect(
      parseFriendLink(`suite://friend?c=${deriveFriendCode(publicKey())}&k=AAAA`),
    ).toMatchObject({ ok: false });
    expect(parseFriendLink("   ")).toEqual({
      ok: false,
      reason: "Paste or scan a friend code first.",
    });
  });
});
