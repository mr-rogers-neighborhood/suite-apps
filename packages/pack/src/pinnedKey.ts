/**
 * The one public key a Suite pack is signed with.
 *
 * Pinned in one place and imported by every host, because a second copy is a second
 * trust root: the phone and the desktop would accept different packs while both
 * calling themselves Suite. The private half is a release secret and lives outside
 * this repository; `pnpm keys status` compares the two.
 */
export const SUITE_PACK_PUBLIC_KEY = "x5QN5OKEGya9gsrbNGaKZMfznsAv6+Cux/qrBYHuSfc=";
