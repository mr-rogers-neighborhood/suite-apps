/**
 * The pack-host default cap for one file, in bytes.
 *
 * One number for every host, so a pack cannot write a file on the desktop that
 * the phone then refuses to read. The shell's external surface uses the same
 * constant.
 */
export const PACK_FILE_MAX_BYTES = 256 * 1024 * 1024;
