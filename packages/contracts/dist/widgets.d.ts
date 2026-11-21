import { z } from "zod";
import { type ContractParse } from "./parse.js";
/** An id inside one app's manifest, or one field's name in a capture. */
export declare const suiteWidgetIdSchema: z.ZodString;
/**
 * The size classes a layout may place a widget at.
 *
 * Three classes, because a host surface is a grid: one cell, two cells, or the whole row.
 * `full` is what the app grid uses by default.
 */
export declare const SUITE_WIDGET_SIZES: readonly ["1x1", "2x1", "full"];
export declare const suiteWidgetSizeSchema: z.ZodEnum<{
    "1x1": "1x1";
    "2x1": "2x1";
    full: "full";
}>;
export type SuiteWidgetSize = (typeof SUITE_WIDGET_SIZES)[number];
/**
 * What a widget may do beyond rendering.
 *
 * One capability in phase 1. It is listed *and* named by the action, and the descriptor
 * refuses the two disagreeing: a widget that declares a capture without the capability
 * would be a host granting itself a write path.
 */
export declare const SUITE_WIDGET_CAPABILITIES: readonly ["capture"];
export declare const suiteWidgetCapabilitySchema: z.ZodEnum<{
    capture: "capture";
}>;
export type SuiteWidgetCapability = (typeof SUITE_WIDGET_CAPABILITIES)[number];
/**
 * The input a declared field asks the host to draw.
 *
 * Deliberately three: a line of text, a calendar day, a whole number. A widget that
 * needs a richer editor opens the full app instead; growing this list is how a widget
 * turns into the page builder the decision rejects.
 */
export declare const SUITE_WIDGET_FIELD_TYPES: readonly ["text", "day", "number"];
export declare const suiteWidgetFieldTypeSchema: z.ZodEnum<{
    number: "number";
    text: "text";
    day: "day";
}>;
export type SuiteWidgetFieldType = (typeof SUITE_WIDGET_FIELD_TYPES)[number];
export declare const suiteWidgetFieldSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    type: z.ZodEnum<{
        number: "number";
        text: "text";
        day: "day";
    }>;
    required: z.ZodDefault<z.ZodBoolean>;
    maxLength: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type SuiteWidgetField = z.infer<typeof suiteWidgetFieldSchema>;
/**
 * The one action phase 1 defines.
 *
 * `fields` is the whole form. The host draws it with its own components, so the app
 * cannot style, script or lay it out; what it can do is say which values it needs and
 * what to call the button that sends them.
 */
export declare const suiteWidgetCaptureActionSchema: z.ZodObject<{
    kind: z.ZodLiteral<"capture">;
    submitLabel: z.ZodDefault<z.ZodString>;
    fields: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        type: z.ZodEnum<{
            number: "number";
            text: "text";
            day: "day";
        }>;
        required: z.ZodDefault<z.ZodBoolean>;
        maxLength: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SuiteWidgetCaptureAction = z.infer<typeof suiteWidgetCaptureActionSchema>;
/**
 * A discriminated union with one member today.
 *
 * Written as a union rather than a bare capture schema because the refusal an app needs
 * is "this build does not know that action", not "this field is missing". Adding `open`
 * or `status` later is a new member, and an older host refuses it at parse time.
 */
export declare const suiteWidgetActionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"capture">;
    submitLabel: z.ZodDefault<z.ZodString>;
    fields: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        type: z.ZodEnum<{
            number: "number";
            text: "text";
            day: "day";
        }>;
        required: z.ZodDefault<z.ZodBoolean>;
        maxLength: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>], "kind">;
export type SuiteWidgetAction = z.infer<typeof suiteWidgetActionSchema>;
export declare const suiteWidgetSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    size: z.ZodEnum<{
        "1x1": "1x1";
        "2x1": "2x1";
        full: "full";
    }>;
    capabilities: z.ZodArray<z.ZodEnum<{
        capture: "capture";
    }>>;
    action: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"capture">;
        submitLabel: z.ZodDefault<z.ZodString>;
        fields: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            type: z.ZodEnum<{
                number: "number";
                text: "text";
                day: "day";
            }>;
            required: z.ZodDefault<z.ZodBoolean>;
            maxLength: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export type SuiteWidget = z.infer<typeof suiteWidgetSchema>;
export declare const suiteWidgetsSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    size: z.ZodEnum<{
        "1x1": "1x1";
        "2x1": "2x1";
        full: "full";
    }>;
    capabilities: z.ZodArray<z.ZodEnum<{
        capture: "capture";
    }>>;
    action: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"capture">;
        submitLabel: z.ZodDefault<z.ZodString>;
        fields: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            type: z.ZodEnum<{
                number: "number";
                text: "text";
                day: "day";
            }>;
            required: z.ZodDefault<z.ZodBoolean>;
            maxLength: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>>;
/** The id a layout names a widget by: `<app id>.<widget id>`. */
export declare function widgetRegistryId(appId: string, widgetId: string): string;
/**
 * Split a layout id back into its app and widget halves.
 *
 * Returns null for anything that is not exactly one dot between two valid ids, so a
 * layout file cannot smuggle a third segment or a host path into an id.
 */
export declare function splitWidgetRegistryId(value: string): {
    readonly appId: string;
    readonly widgetId: string;
} | null;
/**
 * What a host sends when a person submits a capture.
 *
 * `values` is keyed by declared field id and every value is a string: the host draws a
 * text input, a date input and a number input, and an app that needs a number parses it
 * itself rather than trusting a shape it did not write. The app named in the request is
 * the one that owns the widget; the host never sends a document.
 */
export declare const suiteWidgetCaptureSchema: z.ZodObject<{
    widget: z.ZodString;
    action: z.ZodLiteral<"capture">;
    values: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strict>;
export type SuiteWidgetCapture = z.infer<typeof suiteWidgetCaptureSchema>;
/**
 * What the app answers.
 *
 * A refusal is a real answer with a sentence, not an error code: the host shows the
 * sentence and the person decides. `open` is a `suite://` link the host parses before
 * opening, so the app cannot hand over a different scheme and have it launched.
 */
export declare const suiteWidgetCaptureResultSchema: z.ZodUnion<readonly [z.ZodObject<{
    ok: z.ZodLiteral<true>;
    message: z.ZodOptional<z.ZodString>;
    open: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    ok: z.ZodLiteral<false>;
    message: z.ZodString;
}, z.core.$strict>]>;
export type SuiteWidgetCaptureResult = z.infer<typeof suiteWidgetCaptureResultSchema>;
export declare function parseWidgetCaptureResult(value: unknown): ContractParse<SuiteWidgetCaptureResult>;
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
export declare function parseWidgetCapture(value: unknown, widget: Pick<SuiteWidget, "id" | "action">): ContractParse<SuiteWidgetCapture>;
//# sourceMappingURL=widgets.d.ts.map