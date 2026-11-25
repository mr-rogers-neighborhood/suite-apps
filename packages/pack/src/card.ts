import { isSafePackId, isSafePackVersion } from "./manifest.js";

/**
 * The card sidecar published beside a `.suitepack` archive.
 *
 * The signed catalogue index carries no presentation fields: its entry schema
 * is strict, and a host written before cards existed would refuse an index that
 * grew one. A card is therefore a second, unsigned document at a URL derived
 * from the entry's own archive URL:
 *
 *   https://flatpak.suite.run/packs/canvas-0.1.13.suitepack
 *   https://flatpak.suite.run/packs/canvas-0.1.13.card.json
 *
 * A host that has verified the index entry can fetch the card for an
 * uninstalled shadow tile without downloading the archive. The card is
 * presentation only: the archive's signature and file hashes remain the proof,
 * and nothing here decides whether a pack may install.
 *
 * This module is pure, like the rest of `@suite/pack`: the release build reads
 * the icon asset, writes the JSON and stages the file; a host parses what it
 * fetched.
 */

export const PACK_CARD_FORMAT = "suite.pack.card";
export const PACK_CARD_VERSION = 1;
export const CARD_SUFFIX = ".card.json";

/** A card is presentation; this cap keeps a malformed one from becoming a payload. */
export const MAX_CARD_BYTES = 64 * 1024;

/** One card sidecar, as a host reads it. */
export interface PackCard {
  readonly format: typeof PACK_CARD_FORMAT;
  /** The card format version, not the pack's version. */
  readonly version: typeof PACK_CARD_VERSION;
  readonly id: string;
  /** The archive version the card describes. */
  readonly packVersion: string;
  readonly name: string;
  /** One line; a card has no room for a paragraph. */
  readonly description: string;
  /** The suite Home order, not a person's pin order. */
  readonly shelf: number;
  /** A base64 `data:image/svg+xml` or `data:image/png` URI. */
  readonly icon: string;
}

export interface PackCardIssue {
  readonly path: string;
  readonly message: string;
}

export type PackCardParse =
  | { readonly ok: true; readonly value: PackCard }
  | { readonly ok: false; readonly issues: readonly PackCardIssue[] };

const CARD_KEYS = new Set([
  "format",
  "version",
  "id",
  "packVersion",
  "name",
  "description",
  "shelf",
  "icon",
]);

const ICON_DATA_URI = /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/u;

/** `<id>-<version>.suitepack` -> `<id>-<version>.card.json`. */
export function cardFileNameFor(archiveName: string): string {
  if (typeof archiveName !== "string" || !archiveName.toLowerCase().endsWith(".suitepack")) {
    throw new Error(`A card needs a .suitepack archive name, not ${JSON.stringify(archiveName)}.`);
  }
  return `${archiveName.slice(0, -".suitepack".length)}${CARD_SUFFIX}`;
}

/**
 * The card URL for an archive URL, in the same directory.
 *
 * The signed index entry's `url` is the only input, so a host needs no new
 * field and no second base URL. A query string is preserved and the fragment is
 * dropped with the path, matching the archive URL rules in `./catalogue.ts`.
 */
export function cardUrlForArchiveUrl(archiveUrl: string): string {
  let url: URL;
  try {
    url = new URL(archiveUrl);
  } catch {
    throw new Error(`A card needs an absolute archive URL, not ${JSON.stringify(archiveUrl)}.`);
  }
  if (!url.pathname.toLowerCase().endsWith(".suitepack")) {
    throw new Error(`A card needs an archive URL ending in .suitepack, not ${archiveUrl}.`);
  }
  url.pathname = `${url.pathname.slice(0, -".suitepack".length)}${CARD_SUFFIX}`;
  url.hash = "";
  return url.toString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse and validate a card. Accepts the JSON text or the decoded object.
 *
 * Mirrors `parsePackIndexJson` in `./catalogue.ts`: a closed field set, safe ids
 * and versions, and one issue sentence per problem so a refusal names what to
 * fix rather than "invalid card".
 */
export function parsePackCard(input: unknown): PackCardParse {
  let value: unknown = input;
  if (typeof input === "string") {
    const bytes = new TextEncoder().encode(input).byteLength;
    if (bytes > MAX_CARD_BYTES) {
      return {
        ok: false,
        issues: [{ path: "", message: `the card is larger than ${MAX_CARD_BYTES} bytes` }],
      };
    }
    try {
      value = JSON.parse(input);
    } catch (error) {
      return {
        ok: false,
        issues: [{ path: "", message: error instanceof Error ? error.message : "not valid JSON" }],
      };
    }
  }

  if (!isObject(value)) {
    return { ok: false, issues: [{ path: "", message: "a card must be a JSON object" }] };
  }

  const issues: PackCardIssue[] = [];
  for (const key of Object.keys(value)) {
    if (!CARD_KEYS.has(key)) {
      issues.push({ path: key, message: "an unknown card field" });
    }
  }
  for (const key of CARD_KEYS) {
    if (value[key] === undefined) {
      issues.push({ path: key, message: "a required card field" });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  if (value.format !== PACK_CARD_FORMAT) {
    issues.push({ path: "format", message: `must be ${JSON.stringify(PACK_CARD_FORMAT)}` });
  }
  if (value.version !== PACK_CARD_VERSION) {
    issues.push({
      path: "version",
      message: `this host implements card version ${PACK_CARD_VERSION}`,
    });
  }
  if (typeof value.id !== "string" || !isSafePackId(value.id)) {
    issues.push({ path: "id", message: "a lower-case pack id" });
  }
  if (typeof value.packVersion !== "string" || !isSafePackVersion(value.packVersion)) {
    issues.push({ path: "packVersion", message: "a semver version" });
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > 64) {
    issues.push({ path: "name", message: "a non-empty name of at most 64 characters" });
  }
  if (
    typeof value.description !== "string" ||
    value.description.trim().length === 0 ||
    value.description.length > 200 ||
    /[\r\n]/u.test(value.description)
  ) {
    issues.push({
      path: "description",
      message: "one non-empty line of at most 200 characters",
    });
  }
  if (
    typeof value.shelf !== "number" ||
    !Number.isInteger(value.shelf) ||
    value.shelf < 1 ||
    value.shelf > 999
  ) {
    issues.push({ path: "shelf", message: "a whole shelf number from 1 to 999" });
  }
  if (typeof value.icon !== "string" || !ICON_DATA_URI.test(value.icon)) {
    issues.push({ path: "icon", message: "an svg or png base64 data URI" });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: value as unknown as PackCard };
}
