import { describe, expect, it } from "vitest";
import {
  SUITE_INDEX_PUBLIC_KEY,
  SUITE_INDEX_PUBLIC_KEY_FINGERPRINT,
  SUITE_PACK_PUBLIC_KEY,
} from "./pinnedKey.js";
import { base64ToBytes } from "./signature.js";
import { publisherKeyFingerprint } from "./trust.js";

/**
 * The one test for the catalogue operator pin.
 *
 * Both hosts import the constant instead of repeating it, so this is the only place that has to
 * prove the value is the documented key: the helper recomputes the fingerprint, and the literal
 * here is the documented form a person compares. A rotation that edits one and forgets the other
 * fails this test rather than shipping a host that refuses every future index.
 */
describe("the catalogue operator pin", () => {
  it("is a 32-byte key whose documented fingerprint the helper agrees with", async () => {
    expect(base64ToBytes(SUITE_INDEX_PUBLIC_KEY).byteLength).toBe(32);
    expect(SUITE_INDEX_PUBLIC_KEY_FINGERPRINT).toBe(
      "77:F5:4E:74:8A:AF:47:67:45:31:E9:4F:A7:6A:CA:72:F2:85:95:F1:EF:61:40:62:61:36:AC:AC:47:CB:3B:A1",
    );
    expect(await publisherKeyFingerprint(SUITE_INDEX_PUBLIC_KEY)).toBe(
      SUITE_INDEX_PUBLIC_KEY_FINGERPRINT,
    );
    // The catalogue operator and the pack publisher are different trust roots; one key signing
    // both would collapse the separation this file exists to keep.
    expect(SUITE_INDEX_PUBLIC_KEY).not.toBe(SUITE_PACK_PUBLIC_KEY);
  });
});
