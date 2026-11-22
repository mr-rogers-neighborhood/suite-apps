import { z } from "zod";
import { type ContractIssue, type ContractParse, parseWith } from "./parse.js";

/**
 * Widgets — a host surface that shows one thing an app declares.
 *
 * The decision is [Widgets and the dashboard](../../../docs/reference/decisions.md#widgets-and-the-dashboard).
 * Two halves live here and nowhere else:
 *
 * 1. **The descriptor.** An app says what a widget is called, how big it may be and which
 *    fields it takes. It carries no code, no page and no document: the host renders the
 *    fields itself, which is what lets a host that never reads a document show a widget.
 * 2. **The capture.** The host hands over one record of strings; the app validates it
 *    against its own schema, writes through its own document layer and answers with a
 *    sentence. Nothing in the shape names a file, a path or a document.
 *
 * A widget id is app-local — `quick-task` — and the host registers it as
 * `<app id>.<widget id>` so two apps cannot collide and a host widget such as `start.apps`
 * is an ordinary entry in the same table.
 */

const WIDGET_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;

/** An id inside one app's manifest, or one field's name in a capture. */
export const suiteWidgetIdSchema = z
  .string()
  .regex(WIDGET_ID_PATTERN, "a widget id is lower kebab-case, 1-32 characters");

/**
 * The size classes a layout may place a widget at.
 *
 * Three classes, because a host surface is a grid: one cell, two cells, or the whole row.
 * `full` is what the app grid uses by default.
 */
export const SUITE_WIDGET_SIZES = ["1x1", "2x1", "full"] as const;
export const suiteWidgetSizeSchema = z.enum(SUITE_WIDGET_SIZES);
export type SuiteWidgetSize = (typeof SUITE_WIDGET_SIZES)[number];

/**
 * What a widget may do beyond rendering.
 *
 * One capability in phase 1. It is listed *and* named by the action, and the descriptor
 * refuses the two disagreeing: a widget that declares a capture without the capability
 * would be a host granting itself a write path.
 */
export const SUITE_WIDGET_CAPABILITIES = ["capture"] as const;
export const suiteWidgetCapabilitySchema = z.enum(SUITE_WIDGET_CAPABILITIES);
export type SuiteWidgetCapability = (typeof SUITE_WIDGET_CAPABILITIES)[number];

/**
 * The input a declared field asks the host to draw.
 *
 * Deliberately three: a line of text, a calendar day, a whole number. A widget that
 * needs a richer editor opens the full app instead; growing this list is how a widget
 * turns into the page builder the decision rejects.
 */
export const SUITE_WIDGET_FIELD_TYPES = ["text", "day", "number"] as const;
export const suiteWidgetFieldTypeSchema = z.enum(SUITE_WIDGET_FIELD_TYPES);
export type SuiteWidgetFieldType = (typeof SUITE_WIDGET_FIELD_TYPES)[number];

export const suiteWidgetFieldSchema = z
  .object({
    /** The key this field's value carries in the capture. */
    id: suiteWidgetIdSchema,
    label: z.string().min(1).max(64),
    type: suiteWidgetFieldTypeSchema,
    required: z.boolean().default(false),
    /** A ceiling the host enforces while typing. Text fields only: a day and a number have one. */
    maxLength: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.maxLength !== undefined && field.type !== "text") {
      context.addIssue({
        code: "custom",
        path: ["maxLength"],
        message: "only a text field has a length ceiling",
      });
    }
  });

export type SuiteWidgetField = z.infer<typeof suiteWidgetFieldSchema>;

/**
 * The one action phase 1 defines.
 *
 * `fields` is the whole form. The host draws it with its own components, so the app
 * cannot style, script or lay it out; what it can do is say which values it needs and
 * what to call the button that sends them.
 */
export const suiteWidgetCaptureActionSchema = z
  .object({
    kind: z.literal("capture"),
    submitLabel: z.string().min(1).max(32).default("Save"),
    fields: z.array(suiteWidgetFieldSchema).min(1).max(8),
  })
  .strict()
  .superRefine((action, context) => {
    const seen = new Set<string>();
    action.fields.forEach((field, index) => {
      if (seen.has(field.id)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "id"],
          message: `duplicate field ${field.id}`,
        });
        return;
      }
      seen.add(field.id);
    });
  });

export type SuiteWidgetCaptureAction = z.infer<typeof suiteWidgetCaptureActionSchema>;

/**
 * A discriminated union with one member today.
 *
 * Written as a union rather than a bare capture schema because the refusal an app needs
 * is "this build does not know that action", not "this field is missing". Adding `open`
 * or `status` later is a new member, and an older host refuses it at parse time.
 */
export const suiteWidgetActionSchema = z.discriminatedUnion("kind", [
  suiteWidgetCaptureActionSchema,
]);

export type SuiteWidgetAction = z.infer<typeof suiteWidgetActionSchema>;

export const suiteWidgetSchema = z
  .object({
    id: suiteWidgetIdSchema,
    title: z.string().min(1).max(64),
    /** The size the app would like. The layout may place it at any class the host allows. */
    size: suiteWidgetSizeSchema,
    capabilities: z.array(suiteWidgetCapabilitySchema).max(8),
    action: suiteWidgetActionSchema,
  })
  .strict()
  .superRefine((widget, context) => {
    if (!widget.capabilities.includes(widget.action.kind)) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: `the ${widget.action.kind} action needs the ${widget.action.kind} capability`,
      });
    }
  });

export type SuiteWidget = z.infer<typeof suiteWidgetSchema>;

export const suiteWidgetsSchema = z
  .array(suiteWidgetSchema)
  .max(8)
  .superRefine((widgets, context) => {
    const seen = new Set<string>();
    widgets.forEach((widget, index) => {
      if (seen.has(widget.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `duplicate ${widget.id}`,
        });
        return;
      }
      seen.add(widget.id);
    });
  });

/** The id a layout names a widget by: `<app id>.<widget id>`. */
export function widgetRegistryId(appId: string, widgetId: string): string {
  return `${appId}.${widgetId}`;
}

/**
 * Split a layout id back into its app and widget halves.
 *
 * Returns null for anything that is not exactly one dot between two valid ids, so a
 * layout file cannot smuggle a third segment or a host path into an id.
 */
export function splitWidgetRegistryId(
  value: string,
): { readonly appId: string; readonly widgetId: string } | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [appId, widgetId] = parts;
  if (appId === undefined || widgetId === undefined) return null;
  if (!WIDGET_ID_PATTERN.test(appId) || !WIDGET_ID_PATTERN.test(widgetId)) return null;
  return { appId, widgetId };
}

/**
 * What a host sends when a person submits a capture.
 *
 * `values` is keyed by declared field id and every value is a string: the host draws a
 * text input, a date input and a number input, and an app that needs a number parses it
 * itself rather than trusting a shape it did not write. The app named in the request is
 * the one that owns the widget; the host never sends a document.
 */
export const suiteWidgetCaptureSchema = z
  .object({
    widget: suiteWidgetIdSchema,
    action: z.literal("capture"),
    values: z.record(suiteWidgetIdSchema, z.string().max(500)),
  })
  .strict();

export type SuiteWidgetCapture = z.infer<typeof suiteWidgetCaptureSchema>;

/**
 * What the app answers.
 *
 * A refusal is a real answer with a sentence, not an error code: the host shows the
 * sentence and the person decides. `open` is a `suite://` link the host parses before
 * opening, so the app cannot hand over a different scheme and have it launched.
 */
export const suiteWidgetCaptureResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      message: z.string().min(1).max(200).optional(),
      open: z.string().max(2048).optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      message: z.string().min(1).max(200),
    })
    .strict(),
]);

export type SuiteWidgetCaptureResult = z.infer<typeof suiteWidgetCaptureResultSchema>;

export function parseWidgetCaptureResult(value: unknown): ContractParse<SuiteWidgetCaptureResult> {
  return parseWith(suiteWidgetCaptureResultSchema, value);
}

/**
 * Validate a capture against the widget that declared it.
 *
 * Called by the app receiving the capture, beside its own document schema. The contract
 * can check the shape the host promised — the widget id, the declared fields, what is
 * required, the length ceiling — but it cannot know what the values mean, and it does
 * not try: `day` is still a string the app parses into its own date type.
 *
 * Every issue is reported, so a person sees all three problems at once rather than one
 * per submission.
 */
export function parseWidgetCapture(
  value: unknown,
  widget: Pick<SuiteWidget, "id" | "action">,
): ContractParse<SuiteWidgetCapture> {
  const base = parseWith(suiteWidgetCaptureSchema, value);
  if (!base.ok) return base;
  if (widget.action.kind !== "capture") {
    return {
      ok: false,
      issues: [{ path: "action", message: `${widget.id} declares no capture action` }],
    };
  }

  const issues: ContractIssue[] = [];
  const capture = base.value;
  if (capture.widget !== widget.id) {
    issues.push({
      path: "widget",
      message: `expected the ${widget.id} widget`,
    });
  }

  const declared = new Map(widget.action.fields.map((field) => [field.id, field]));
  for (const key of Object.keys(capture.values)) {
    if (!declared.has(key)) issues.push({ path: `values.${key}`, message: "not a declared field" });
  }

  for (const field of declared.values()) {
    const value = capture.values[field.id];
    if (value === undefined || value.trim().length === 0) {
      if (field.required) {
        issues.push({ path: `values.${field.id}`, message: "required" });
      }
      continue;
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      issues.push({
        path: `values.${field.id}`,
        message: `at most ${field.maxLength} characters`,
      });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: capture };
}
