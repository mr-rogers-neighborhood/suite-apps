import { z } from "zod";
import { ScreenDocument } from "./document.js";
import {
  type Screen,
  type ScreenRefusal,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  screenCorruption,
  suiteScreenIdSchema,
  suiteScreenNameSchema,
} from "./screen.js";

/**
 * The portable `.screen` file.
 *
 * A Screen is a real file the person owns: one Loro snapshot inside a small, versioned
 * envelope. The envelope is not a second document shape; it exists so an importer can
 * refuse a newer file before decoding the snapshot, and so the file carries the id,
 * name and whether it was the writer's Home without a host path or secret.
 *
 * Layout:
 *
 *   magic       12 bytes  "SUITE-SCREEN"
 *   envelope    2 bytes   unsigned, big-endian; currently 1
 *   header     4 bytes    unsigned, big-endian; canonical JSON byte length
 *   header               format, version, id, name, home, payloadLength
 *   payload              one Loro snapshot
 *
 * The header is canonical by construction: one fixed key order and no whitespace. The
 * payload is the current Screen version; an older payload is migrated by the same chain
 * the host uses for its own stored document. The envelope itself has its own version so
 * a later container change is a different refusal from a later Screen shape.
 */

export const SCREEN_FILE_MAGIC = "SUITE-SCREEN";
export const SCREEN_FILE_ENVELOPE_VERSION = 1;
export const SCREEN_FILE_EXTENSION = ".screen";
export const SCREEN_FILE_MEDIA_TYPE = "application/vnd.suite.screen";
export const SCREEN_FILE_MAX_BYTES = 4 * 1024 * 1024;

const MAGIC_BYTES = new TextEncoder().encode(SCREEN_FILE_MAGIC);
const PREFIX_BYTES = MAGIC_BYTES.byteLength + 2 + 4;

const suiteScreenFileHeaderSchema = z
  .object({
    format: z.literal(SUITE_SCREEN_FORMAT),
    version: z.number().int().min(1),
    id: suiteScreenIdSchema,
    name: suiteScreenNameSchema,
    home: z.boolean(),
    payloadLength: z.number().int().min(0),
  })
  .strict();

export type ScreenFileHeader = z.infer<typeof suiteScreenFileHeaderSchema>;

export type ScreenFileParse =
  | {
      readonly ok: true;
      readonly document: ScreenDocument;
      readonly screen: Screen;
      readonly home: boolean;
      /** The Screen version the payload arrived with. */
      readonly fromVersion: number;
    }
  | ScreenRefusal;

function newerEnvelope(version: number): ScreenRefusal {
  return {
    ok: false,
    reason: "newer",
    message: `This screen file uses Suite screen file envelope ${version}, and this build understands up to ${SCREEN_FILE_ENVELOPE_VERSION}. Update Suite Desk to import it. The file has been left alone.`,
    issues: [],
  };
}

function newerScreen(version: number): ScreenRefusal {
  return {
    ok: false,
    reason: "newer",
    message: `This screen file is Suite screen version ${version}, and this build understands up to ${SUITE_SCREEN_VERSION}. Update Suite Desk to import it. The file has been left alone.`,
    issues: [],
  };
}

/**
 * Wrap one current Screen document in the portable envelope.
 *
 * `home` records that the writer had made this Screen its Home. It is the only host
 * fact in the file; no path, key or app data is added.
 */
export function exportScreenFile(
  document: ScreenDocument,
  options: { readonly home?: boolean } = {},
): Uint8Array {
  return encodeScreenFile(document, options.home === true);
}

function encodeScreenFile(document: ScreenDocument, home: boolean): Uint8Array {
  const screen = document.state();
  const payload = document.export();
  const header: ScreenFileHeader = {
    format: SUITE_SCREEN_FORMAT,
    version: screen.version,
    id: screen.id,
    name: screen.name,
    home,
    payloadLength: payload.byteLength,
  };
  const body = new TextEncoder().encode(
    JSON.stringify({
      format: header.format,
      version: header.version,
      id: header.id,
      name: header.name,
      home: header.home,
      payloadLength: header.payloadLength,
    }),
  );

  const envelope = new Uint8Array(PREFIX_BYTES + body.byteLength + payload.byteLength);
  envelope.set(MAGIC_BYTES, 0);
  const view = new DataView(envelope.buffer);
  view.setUint16(MAGIC_BYTES.byteLength, SCREEN_FILE_ENVELOPE_VERSION);
  view.setUint32(MAGIC_BYTES.byteLength + 2, body.byteLength);
  envelope.set(body, PREFIX_BYTES);
  envelope.set(payload, PREFIX_BYTES + body.byteLength);
  return envelope;
}

function isScreenFileFormat(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MAGIC_BYTES.byteLength) return false;
  return MAGIC_BYTES.every((value, index) => bytes[index] === value);
}

function readHeader(bytes: Uint8Array): ScreenRefusal | ScreenFileHeader {
  if (bytes.byteLength > SCREEN_FILE_MAX_BYTES) {
    return screenCorruption(
      `This screen file is larger than the ${SCREEN_FILE_MAX_BYTES} byte limit, so it cannot be imported.`,
    );
  }
  if (!isScreenFileFormat(bytes)) {
    return screenCorruption("This file is not a Suite screen file.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const envelopeVersion = view.getUint16(MAGIC_BYTES.byteLength);
  if (envelopeVersion > SCREEN_FILE_ENVELOPE_VERSION) return newerEnvelope(envelopeVersion);
  if (envelopeVersion !== SCREEN_FILE_ENVELOPE_VERSION) {
    return screenCorruption(
      `This screen file uses envelope ${envelopeVersion}, and this build reads envelope ${SCREEN_FILE_ENVELOPE_VERSION}. Re-export it from a Suite that writes this format.`,
    );
  }

  const headerLength = view.getUint32(MAGIC_BYTES.byteLength + 2);
  const payloadOffset = PREFIX_BYTES + headerLength;
  if (headerLength === 0 || payloadOffset > bytes.byteLength) {
    return screenCorruption("This screen file is cut short, so it cannot be imported.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(PREFIX_BYTES, payloadOffset)),
    );
  } catch {
    return screenCorruption("This screen file's header is not readable text.");
  }

  const parsed = suiteScreenFileHeaderSchema.safeParse(raw);
  if (!parsed.success) {
    return screenCorruption("This screen file's header does not name a Suite screen.");
  }
  if (parsed.data.version > SUITE_SCREEN_VERSION) return newerScreen(parsed.data.version);
  if (parsed.data.payloadLength !== bytes.byteLength - payloadOffset) {
    return screenCorruption(
      "This screen file's header does not match its bytes, so it cannot be imported.",
    );
  }
  return parsed.data;
}

function isScreenRefusal(value: unknown): value is ScreenRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false
  );
}

/**
 * Read one portable file without writing anything.
 *
 * The envelope is checked first, then the snapshot through `ScreenDocument.open` and
 * the same migration chain as a stored document. A refusal leaves the caller's Screen
 * set untouched; the caller decides whether to open the file at all.
 */
export function parseScreenFile(bytes: Uint8Array): ScreenFileParse {
  if (bytes.byteLength > SCREEN_FILE_MAX_BYTES) {
    return screenCorruption(
      `This screen file is larger than the ${SCREEN_FILE_MAX_BYTES} byte limit, so it cannot be imported.`,
    );
  }

  const header = readHeader(bytes);
  if (isScreenRefusal(header)) return header;

  const payloadOffset =
    PREFIX_BYTES +
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      MAGIC_BYTES.byteLength + 2,
    );
  const opened = ScreenDocument.open(bytes.subarray(payloadOffset));
  if (!opened.ok) return opened;

  if (header.version !== opened.fromVersion) {
    return screenCorruption(
      "This screen file's header names a different version than its contents. Re-export it from Suite Desk.",
    );
  }

  const screen = opened.document.state();
  if (screen.id !== header.id || screen.name !== header.name) {
    return screenCorruption(
      "This screen file's header names a different Screen than its contents. Re-export it from Suite Desk.",
    );
  }

  return {
    ok: true,
    document: opened.document,
    screen,
    home: header.home,
    fromVersion: opened.fromVersion,
  };
}
