/**
 * The public keys a Suite host pins.
 *
 * Each is pinned in one place and imported by every host, because a second copy is a second trust
 * root: the phone and the desktop would accept different packs, or read different catalogues,
 * while both calling themselves Suite. The private halves are release secrets and live outside
 * this repository; `pnpm keys status` compares the pack one.
 */
export const SUITE_PACK_PUBLIC_KEY = "x5QN5OKEGya9gsrbNGaKZMfznsAv6+Cux/qrBYHuSfc=";

/**
 * The stable publisher id the pinned key carries (S2.2).
 *
 * The id survives a rotation, so it belongs beside the key rather than in each
 * manifest: a first-party pack may omit `publisher.id` and still resolve to the
 * one publisher every Suite host preinstalls.
 */
export const SUITE_PUBLISHER_ID = "suite";

/**
 * The one catalogue operator key every Suite host trusts (S12.2).
 *
 * An index carries its own signatures, so the key that verifies them cannot come from the index:
 * a signature checked against a key the response supplied proves only that the response is
 * self-consistent. This key is compiled into both hosts, which import it from here instead of
 * keeping a copy, and a caller cannot replace it. `apps/desk/src/indexTrust.ts` and
 * `apps/go/src/host/catalogue.ts` each pass it to `verifyPackIndex`; neither holds a second value.
 *
 * It is a *host* trust root, not the publisher's signing key. The release tooling signs with
 * `SUITE_INDEX_KEY` from the release environment; `SUITE_INDEX_KEY_FINGERPRINT` is the separate
 * value that secret must match before it signs. Keeping the two apart is deliberate: a staging or
 * next key can sign an index without changing what an installed host trusts.
 *
 * Rotating it is one edit and one release: replace this constant and the fingerprint below, sign
 * the next index with the new key, and both hosts trust it in the same release. A host that missed
 * that release refuses every later index, which reads as a broken store rather than a stale pin,
 * so `pinnedKey.test.ts` recomputes the fingerprint and a half-done rotation fails the gate.
 */
export const SUITE_INDEX_PUBLIC_KEY = "g/0ccvgNKdfiHC+i5wPDQqvPVhAyxBX8ZjrdzTi1zF8=";

/**
 * The fingerprint form of `SUITE_INDEX_PUBLIC_KEY`, for places a person reads and compares.
 *
 * The key above is what a verifier passes; this is the value documentation, an operator's notes
 * and a key check show. It is derived, never authoritative: `pinnedKey.test.ts` computes it from
 * the key with `publisherKeyFingerprint`, so the two cannot drift apart. The release step's
 * `SUITE_INDEX_KEY_FINGERPRINT` uses the same shape but pins what the signing environment holds,
 * not what an installed host trusts.
 */
export const SUITE_INDEX_PUBLIC_KEY_FINGERPRINT =
  "77:F5:4E:74:8A:AF:47:67:45:31:E9:4F:A7:6A:CA:72:F2:85:95:F1:EF:61:40:62:61:36:AC:AC:47:CB:3B:A1";
