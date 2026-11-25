/**
 * The Node side of the pack card sidecar.
 *
 * The format, URL rule and validation live in `@suite/pack` (`card.ts`), where
 * the phone can import them. This module re-exports those helpers for the
 * release scripts and keeps what only a build machine can do: read the icon
 * artwork, choose the shelf order, and write the JSON beside the archive.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_SUFFIX,
  MAX_CARD_BYTES,
  PACK_CARD_FORMAT,
  PACK_CARD_VERSION,
  cardFileNameFor,
  cardUrlForArchiveUrl,
  parsePackCard,
} from "@suite/pack";

export {
  CARD_SUFFIX,
  MAX_CARD_BYTES,
  PACK_CARD_FORMAT as CARD_FORMAT,
  PACK_CARD_VERSION as CARD_VERSION,
  cardFileNameFor,
  cardUrlForArchiveUrl,
  parsePackCard,
};

/** The card path beside an archive path. */
export function cardPathForArchive(archivePath) {
  return join(dirname(archivePath), cardFileNameFor(basename(archivePath)));
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

/** An existing SVG asset as a data URI, for an app that already ships its mark. */
export function iconFromSvgFile(path) {
  return `data:image/svg+xml;base64,${Buffer.from(readFileSync(path, "utf8"), "utf8").toString(
    "base64",
  )}`;
}

/**
 * Canvas, Planner and Budget already draw these glyphs in their `AppMark`.
 * Help has its own headset in `legacy/help/resources/icon.svg`.
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

const HELP_ICON = fileURLToPath(new URL("../../legacy/help/resources/icon.svg", import.meta.url));

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
    icon: iconFromSvgFile(HELP_ICON),
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
    format: PACK_CARD_FORMAT,
    version: PACK_CARD_VERSION,
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
