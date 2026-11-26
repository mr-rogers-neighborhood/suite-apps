import {
  type ContractIssue,
  describeIssues,
  parseWith,
  splitWidgetRegistryId,
  suiteWidgetIdSchema,
  suiteWidgetSizeSchema,
} from "@suite/contracts";
import { z } from "zod";

/**
 * A Screen — the host's composition of widget instances.
 *
 * The decision is [Widgets and Screens](../../../docs/reference/decisions.md#widgets-and-screens).
 * A Screen is the host's document, not an app's: it names which widgets are placed, at
 * what size and with which instance settings. It carries no app data, no code and no
 * path. The Loro half lives in `document.ts`; this module is the shape and its parser.
 *
 * Two rules shape the parser:
 *
 * - A registry id stays whatever the Screen says. This package does not know which apps
 *   are installed, so an id it cannot resolve is retained, not dropped. The host draws
 *   the unknown tile and keeps the entry.
 * - A newer version is refused with a sentence. Guessing at a shape written by a
 *   future build is how one field silently becomes another.
 */

export const SUITE_SCREEN_FORMAT = "suite.screen";

/** Bumped when the shape changes; an older reader refuses rather than guesses. */
export const SUITE_SCREEN_VERSION = 2;

/** The placement budget, rows included. Keeps one Screen bounded on every host. */
export const MAX_SCREEN_PLACEMENTS = 64;

/** A Screen's own id. The host chooses the file path; this is never a path itself. */
const SCREEN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export const suiteScreenIdSchema = z
  .string()
  .regex(SCREEN_ID_PATTERN, "a screen id is lower kebab-case, 1-64 characters");

export const suiteScreenNameSchema = z.string().min(1).max(120);

/**
 * The key an instance setting uses.
 *
 * It is the descriptor's settings field id, so it follows the widget id grammar. The
 * value is always a string: the descriptor says whether it is text, a day or a number,
 * and the app parses it when a capture arrives.
 */
export const suiteScreenSettingsSchema = z.record(suiteWidgetIdSchema, z.string().max(500));

/** `<app id>.<widget id>`, with the contract's own splitter as the only definition. */
export const suiteScreenRegistryIdSchema = z
  .string()
  .refine((value) => splitWidgetRegistryId(value) !== null, {
    message: "a registry id is <app id>.<widget id>",
  });

export const suiteScreenWidgetSchema = z
  .object({
    registryId: suiteScreenRegistryIdSchema,
    size: suiteWidgetSizeSchema,
    settings: suiteScreenSettingsSchema.optional(),
  })
  .strict();

export type SuiteScreenWidget = z.infer<typeof suiteScreenWidgetSchema>;

/**
 * How a row behaves when its window is wider than a phone.
 *
 * `row` shares the width by weight and wraps; `carousel` keeps one scrolling line at
 * every width. Every row becomes a horizontal, snapping line at phone width, so two
 * widgets never squeeze into unreadable half columns.
 */
export const SCREEN_ROW_LAYOUTS = ["row", "carousel"] as const;
export const suiteScreenRowLayoutSchema = z.enum(SCREEN_ROW_LAYOUTS);
export type ScreenRowLayout = (typeof SCREEN_ROW_LAYOUTS)[number];

/**
 * One child of a row.
 *
 * `weight` is the relative width on a wide window: two items at 2 and 1 take two
 * thirds and one third. It is not pixels and not a grid column, so the same Screen
 * lays out on a desktop and a phone without a second model.
 */
export const suiteScreenRowItemSchema = z
  .object({
    registryId: suiteScreenRegistryIdSchema,
    weight: z.number().int().min(1).max(12),
    settings: suiteScreenSettingsSchema.optional(),
  })
  .strict();

export type SuiteScreenRowItem = z.infer<typeof suiteScreenRowItemSchema>;

/** A row groups widgets one level deep. A row cannot contain a row or a Screen. */
export const suiteScreenRowSchema = z
  .object({
    kind: z.literal("row"),
    size: suiteWidgetSizeSchema,
    layout: suiteScreenRowLayoutSchema.default("row"),
    items: z.array(suiteScreenRowItemSchema).min(2).max(8),
  })
  .strict();

export type SuiteScreenRow = z.infer<typeof suiteScreenRowSchema>;

export const suiteScreenEntrySchema = z.union([suiteScreenWidgetSchema, suiteScreenRowSchema]);

export type ScreenEntry = z.infer<typeof suiteScreenEntrySchema>;

/** Whether one entry is the row primitive. */
export function isScreenRow(entry: unknown): entry is SuiteScreenRow {
  return (
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    (entry as Record<string, unknown>).kind === "row"
  );
}

/** The registry ids one entry places, in document order. */
export function screenEntryRegistryIds(entry: ScreenEntry): readonly string[] {
  return isScreenRow(entry) ? entry.items.map((item) => item.registryId) : [entry.registryId];
}

/**
 * The whole document. `.strict()` is the point: a JSON key such as `entry`, `html`,
 * `script`, `path`, `document` or `data` is refused, so a Screen cannot grow into a
 * page builder or a second copy of app data.
 */
export const suiteScreenSchema = z
  .object({
    format: z.literal(SUITE_SCREEN_FORMAT),
    version: z.literal(SUITE_SCREEN_VERSION),
    id: suiteScreenIdSchema,
    name: suiteScreenNameSchema,
    widgets: z.array(suiteScreenEntrySchema).max(MAX_SCREEN_PLACEMENTS),
  })
  .strict()
  .superRefine((screen, context) => {
    const seen = new Set<string>();
    let placements = 0;

    screen.widgets.forEach((entry, index) => {
      const items = isScreenRow(entry) ? entry.items : [entry];
      placements += items.length;

      items.forEach((item, itemIndex) => {
        if (seen.has(item.registryId)) {
          context.addIssue({
            code: "custom",
            path: isScreenRow(entry)
              ? ["widgets", index, "items", itemIndex, "registryId"]
              : ["widgets", index, "registryId"],
            message: `duplicate ${item.registryId}`,
          });
          return;
        }
        seen.add(item.registryId);
      });
    });

    if (placements > MAX_SCREEN_PLACEMENTS) {
      context.addIssue({
        code: "custom",
        path: ["widgets"],
        message: `a Screen places at most ${MAX_SCREEN_PLACEMENTS} widgets`,
      });
    }
  });

export type Screen = z.infer<typeof suiteScreenSchema>;

export type ScreenRefusalReason = "corrupt" | "newer";

/** The refusal a host shows. `message` is a complete sentence, not a code. */
export interface ScreenRefusal {
  readonly ok: false;
  readonly reason: ScreenRefusalReason;
  readonly message: string;
  readonly issues: readonly ContractIssue[];
}

export type ScreenParse = { readonly ok: true; readonly value: Screen } | ScreenRefusal;

export function corruptScreenRefusal(
  message: string,
  issues: readonly ContractIssue[] = [],
): ScreenRefusal {
  return { ok: false, reason: "corrupt", message, issues };
}

/** Build the refusal a host shows when a snapshot or state is not a Screen. */
export function screenCorruption(
  message: string,
  issues: readonly ContractIssue[] = [],
): ScreenRefusal {
  return corruptScreenRefusal(message, issues);
}

/**
 * Parse one Screen.
 *
 * `format` is checked first so a dashboard or an app document says "not a screen"
 * rather than listing missing fields. A numeric version above this build's is the one
 * case that gets a distinct reason and sentence: the host can explain it and leave the
 * file alone. An older version is migrated by `migration.ts`, not guessed at here.
 */
export function parseScreen(value: unknown): ScreenParse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return screenCorruption("This file is not a Suite screen.");
  }

  const raw = value as Record<string, unknown>;
  if (raw.format !== SUITE_SCREEN_FORMAT) {
    return screenCorruption("This file is not a Suite screen.");
  }

  if (
    typeof raw.version === "number" &&
    Number.isInteger(raw.version) &&
    raw.version > SUITE_SCREEN_VERSION
  ) {
    return {
      ok: false,
      reason: "newer",
      message:
        "This screen was written by a newer Suite, so this version cannot open it. Open it in a newer Suite Desk. The file has been left alone.",
      issues: [],
    };
  }

  const parsed = parseWith(suiteScreenSchema, value);
  if (!parsed.ok) {
    return screenCorruption(
      `This screen could not be read: ${describeIssues(parsed.issues)}.`,
      parsed.issues,
    );
  }
  return { ok: true, value: parsed.value };
}
