import type { LoroDoc, LoroMap } from "loro-crdt";

import { currencyScale } from "../money";
import { type Settings, settingsSchema } from "../schema";
import { ROOTS } from "./constants";
import { asMap } from "./helpers";

const DEFAULTS = settingsSchema.parse({});

export function ensureSettings(doc: LoroDoc, overrides: Partial<Settings> = {}): Settings {
  const map = doc.getMap(ROOTS.settings);
  const existing = map.get("currency") === undefined ? null : readSettings(doc);
  const next = settingsSchema.parse({ ...DEFAULTS, ...existing, ...overrides });
  const target: LoroMap = map;
  for (const [key, value] of Object.entries(next)) target.set(key, value);
  return next;
}

export function readSettings(doc: LoroDoc): Settings {
  return settingsSchema.parse(doc.getMap(ROOTS.settings).toJSON());
}

export function updateSettings(doc: LoroDoc, patch: Partial<Settings>): Settings {
  const current = readSettings(doc);
  // A currency change moves the scale with it unless the same patch names a scale. One budget
  // has one currency, so a document must not end up displaying dollars at yen precision.
  const changes: Partial<Settings> = { ...patch };
  if (patch.currency !== undefined) {
    const currency = patch.currency.toUpperCase();
    changes.currency = currency;
    if (patch.currencyScale === undefined) changes.currencyScale = currencyScale(currency);
  }
  const next = settingsSchema.parse({ ...current, ...changes });
  const map: LoroMap | undefined = asMap(doc.getMap(ROOTS.settings));
  if (!map) throw new Error("Settings root is missing");
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) map.set(key, value);
  }
  return next;
}
