/**
 * The card sidecar published beside a `.suitepack` archive.
 *
 * The signed catalogue index deliberately carries no presentation fields: its
 * entry schema is strict, and a host written before cards existed would refuse
 * an index that grew one. A card is therefore a second, unsigned document at a
 * URL derived from the entry's own archive URL:
 *
 *   https://flatpak.suite.run/packs/canvas-0.1.13.suitepack
 *   https://flatpak.suite.run/packs/canvas-0.1.13.card.json
 *
 * A host that has verified the index entry can fetch the card for an
 * uninstalled shadow tile without downloading the archive. The card is
 * presentation only: the archive's signature and file hashes remain the proof,
 * and nothing here decides whether a pack may install.
 *
 * The shape is intentionally small and closed. `format` names the document,
 * `version` is the card format (not the pack version), and `packVersion` is the
 * archive the card describes. `shelf` is the suite's Home order, not a
 * person's pin order. `icon` is a data URI so the whole card is one fetch.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSafePackId, isSafePackVersion } from "@suite/pack";

export const CARD_FORMAT = "suite.pack.card";
export const CARD_VERSION = 1;
export const CARD_SUFFIX = ".card.json";

/** A card is presentation; this cap keeps a malformed one from becoming a payload. */
export const MAX_CARD_BYTES = 64 * 1024;

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
export function cardFileNameFor(archiveName) {
  if (typeof archiveName !== "string" || !archiveName.toLowerCase().endsWith(".suitepack")) {
    throw new Error(`A card needs a .suitepack archive name, not ${JSON.stringify(archiveName)}.`);
  }
  return `${archiveName.slice(0, -".suitepack".length)}${CARD_SUFFIX}`;
}

/** The card path beside an archive path. */
export function cardPathForArchive(archivePath) {
  return join(dirname(archivePath), cardFileNameFor(basename(archivePath)));
}

/**
 * The card URL for an archive URL, in the same directory.
 *
 * The signed index entry's `url` is the only input, so a host needs no new
 * field and no second base URL. A query string is preserved and the fragment is
 * dropped with the path, matching the archive URL rules in `@suite/pack`.
 */
export function cardUrlForArchiveUrl(archiveUrl) {
  let url;
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

/**
 * An SVG icon as a data URI.
 *
 * The glyph is the same path data the app's `AppMark` draws. The tile colour is
 * the suite accent, so a card does not depend on the host's theme to be legible.
 */
export function iconFromGlyph({ viewBox, paths, background = "#1f6feb", foreground = "#ffffff" }) {
  const size = Number(viewBox.trim().split(/\s+/u)[2]);
  const radius = Number.isFinite(size) && size > 0 ? Math.round(size * 0.3) : 7;
  const drawing = paths
    .map((path) => `<path d="${path}"/>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<rect width="100%" height="100%" rx="${radius}" fill="${background}"/>` +
    `<g fill="${foreground}">${drawing}</g>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** A PNG asset as a data URI, used for the suite mark until Help has its own. */
export function pngIcon(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * Canvas, Planner and Budget already draw these glyphs in their `AppMark`.
 * Help has no app mark yet, so its card uses the Suite Desk mark as a
 * placeholder; replace it when Help gets artwork of its own (#381).
 */
const CANVAS_GLYPH = [
  "M10 3H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1M9 9H5V5h4zm11 4h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1m-1 6h-4v-4h4zM17 3c-2.206 0-4 1.794-4 4s1.794 4 4 4s4-1.794 4-4s-1.794-4-4-4m0 6c-1.103 0-2-.897-2-2s.897-2 2-2s2 .897 2 2s-.897 2-2 2M7 13c-2.206 0-4 1.794-4 4s1.794 4 4 4s4-1.794 4-4s-1.794-4-4-4m0 6c-1.103 0-2-.897-2-2s.897-2 2-2s2 .897 2 2s-.897 2-2 2",
];

const PLANNER_GLYPH = [
  "M10 18c0-1.3-.8-2.4-2-2.8v-3.4c1.2-.4 2-1.5 2-2.8c0-1.7-1.3-3-3-3S4 7.3 4 9c0 1.3.8 2.4 2 2.8v3.4c-1.2.4-2 1.5-2 2.8s.8 2.4 2 2.8v3.4c-1.2.4-2 1.5-2 2.8c0 1.7 1.3 3 3 3s3-1.3 3-3c0-1.3-.8-2.4-2-2.8v-3.4c1.2-.4 2-1.5 2-2.8m21-8H15c-.6 0-1-.4-1-1s.4-1 1-1h16c.6 0 1 .4 1 1s-.4 1-1 1m0 9H15c-.6 0-1-.4-1-1s.4-1 1-1h16c.6 0 1 .4 1 1s-.4 1-1 1m0 9H15c-.6 0-1-.4-1-1s.4-1 1-1h16c.6 0 1 .4 1 1s-.4 1-1 1",
];

const BUDGET_GLYPH = [
  "M13 11h7v2h-7z",
  "M29 13h-2.02A5.78 5.78 0 0 0 25 8.852V5a1 1 0 0 0-1.6-.8L19.667 7H15c-5.51 0-9.463 3.241-9.948 8H5a1 1 0 0 1-1-1v-2H2v2a3.003 3.003 0 0 0 3 3h.07A9.17 9.17 0 0 0 9 23.557V27a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2h3v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-3.363A5.1 5.1 0 0 0 26.819 20H29a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1m-1 5h-2.876c-.305 2.753-.823 3.485-3.124 4.315V26h-2v-3h-7v3h-2v-3.622A7.01 7.01 0 0 1 7 16c0-4.835 4.018-7 8-7h5.334L23 7v2.776c2.418 1.86 1.913 3.186 2.018 5.224H28Z",
];

const SUITE_ICON = fileURLToPath(
  new URL("../../apps/shell/build/icons/64x64.png", import.meta.url),
);

/** The shelf order and artwork each published card carries. */
export const PACK_CARD_META = {
  canvas: {
    shelf: 1,
    icon: iconFromGlyph({ viewBox: "0 0 24 24", paths: CANVAS_GLYPH }),
  },
  planner: {
    shelf: 2,
    icon: iconFromGlyph({ viewBox: "0 0 36 36", paths: PLANNER_GLYPH }),
  },
  budget: {
    shelf: 3,
    icon: iconFromGlyph({ viewBox: "0 0 32 32", paths: BUDGET_GLYPH }),
  },
  help: {
    shelf: 4,
    // Help has no app mark; the Suite Desk mark is a placeholder.
    icon: pngIcon(readFileSync(SUITE_ICON)),
  },
};

/** The card for one manifest, with the metadata this repository publishes. */
export function cardForManifest(manifest, { shelf, icon }) {
  if (manifest === null || typeof manifest !== "object") {
    throw new Error("A card needs a built manifest.");
  }
  if (typeof manifest.description !== "string" || manifest.description.trim().length === 0) {
    throw new Error(`${manifest.id ?? "The pack"} has no description, so its card has no one-liner.`);
  }
  return {
    format: CARD_FORMAT,
    version: CARD_VERSION,
    id: manifest.id,
    packVersion: manifest.version,
    name: manifest.name,
    description: manifest.description,
    shelf,
    icon,
  };
}

/** The card for a manifest whose id has an entry in `PACK_CARD_META`. */
export function cardFor(manifest) {
  const meta = PACK_CARD_META[manifest?.id];
  if (meta === undefined) {
    throw new Error(
      `No card artwork for ${JSON.stringify(manifest?.id)}; add it to PACK_CARD_META in scripts/lib/packCard.mjs.`,
    );
  }
  return cardForManifest(manifest, meta);
}

/**
 * Write the card beside its archive and return what was written.
 *
 * The JSON is formatted once and parsed before it is written, so a card this
 * build cannot read is never published next to an archive a host can install.
 */
export function writePackCard({ archivePath, manifest }) {
  const card = cardFor(manifest);
  const text = `${JSON.stringify(card, null, 2)}\n`;
  const parsed = parsePackCard(text);
  if (!parsed.ok) {
    throw new Error(
      `The card for ${manifest.id} would be invalid: ${parsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const path = cardPathForArchive(archivePath);
  writeFileSync(path, text);
  return { path, card: parsed.value, text };
}

/**
 * Parse and validate a card. Accepts the JSON text or the decoded object.
 *
 * Mirrors `parsePackIndexJson` in `@suite/pack`: a closed field set, safe ids
 * and versions, and one issue sentence per problem so a refusal names what to
 * fix rather than "invalid card".
 */
export function parsePackCard(input) {
  let value = input;
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
        issues: [
          { path: "", message: error instanceof Error ? error.message : "not valid JSON" },
        ],
      };
    }
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "", message: "a card must be a JSON object" }] };
  }

  const issues = [];
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

  if (value.format !== CARD_FORMAT) {
    issues.push({
      path: "format",
      message: `must be ${JSON.stringify(CARD_FORMAT)}`,
    });
  }
  if (value.version !== CARD_VERSION) {
    issues.push({
      path: "version",
      message: `this host implements card version ${CARD_VERSION}`,
    });
  }
  if (!isSafePackId(value.id)) {
    issues.push({ path: "id", message: "a lower-case pack id" });
  }
  if (!isSafePackVersion(value.packVersion)) {
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
  if (!Number.isInteger(value.shelf) || value.shelf < 1 || value.shelf > 999) {
    issues.push({ path: "shelf", message: "a whole shelf number from 1 to 999" });
  }
  if (typeof value.icon !== "string" || !ICON_DATA_URI.test(value.icon)) {
    issues.push({
      path: "icon",
      message: "an svg or png base64 data URI",
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value };
}
