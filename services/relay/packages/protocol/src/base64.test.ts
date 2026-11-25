import { describe, expect, it } from "vitest";
import { decodeBase64, decodeBase64Url, encodeBase64, encodeBase64Url } from "./base64.js";

describe("base64", () => {
  it("encodes and decodes every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const encoded = encodeBase64(bytes);
    const decoded = decodeBase64(encoded);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded ?? [])).toEqual(Array.from(bytes));
  });

  it("handles the three padding cases", () => {
    expect(encodeBase64(Uint8Array.from([0x66]))).toBe("Zg==");
    expect(encodeBase64(Uint8Array.from([0x66, 0x6f]))).toBe("Zm8=");
    expect(encodeBase64(Uint8Array.from([0x66, 0x6f, 0x6f]))).toBe("Zm9v");
  });

  it("round-trips an empty payload", () => {
    expect(encodeBase64(new Uint8Array())).toBe("");
    expect(decodeBase64("")).toEqual(new Uint8Array());
  });

  it("refuses a character outside the alphabet", () => {
    expect(decodeBase64("not base64!")).toBeNull();
    expect(decodeBase64("AB=CD")).toBeNull();
  });
});

describe("base64url", () => {
  it("round-trips every byte value without padding or characters a query string escapes", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const encoded = encodeBase64Url(bytes);
    expect(encoded).not.toMatch(/[=+/]/u);
    expect(Array.from(decodeBase64Url(encoded) ?? [])).toEqual(Array.from(bytes));
  });

  it("drops padding and uses the URL-safe alphabet", () => {
    // 0xfb 0xff encodes as "+/8=" in standard base64.
    expect(encodeBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe("-_8");
    expect(decodeBase64Url("-_8")).toEqual(Uint8Array.from([0xfb, 0xff]));
  });

  it("refuses standard-alphabet, padded or spaced values", () => {
    expect(decodeBase64Url("+/8=")).toBeNull();
    expect(decodeBase64Url("AAAA ")).toBeNull();
    expect(decodeBase64Url("AA\nAA")).toBeNull();
    expect(decodeBase64Url("-_8=")).toBeNull();
    expect(decodeBase64Url("")).toEqual(new Uint8Array());
  });

  it("refuses trailing bits that another spelling could have produced", () => {
    // "-_9" decodes to the same two bytes as "-_8", but only "-_8" re-encodes to itself.
    expect(decodeBase64Url("-_9")).toBeNull();
    // The standard decoder stays forgiving, because signatures and other old payloads
    // already depend on it accepting the same bytes.
    expect(Array.from(decodeBase64("+/9=") ?? [])).toEqual([0xfb, 0xff]);
  });
});
