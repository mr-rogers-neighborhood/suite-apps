import type { Paintable } from "./apply.js";
/**
 * Type sizes, control density, radius, elevation and motion, named.
 *
 * These are the second axis of the theme, after colour. Colour roles say what a thing *is*;
 * these say how big it is and how much room it gets.
 *
 * ## Why the values look like the ones they replaced
 *
 * The primitives used five unrelated pixel sizes and two control heights, and the obvious move
 * is a tidy scale with fewer steps. That is not this. Every value here reproduces what shipped,
 * because a type scale that arrives with a redesign is two changes wearing one coat: nobody can
 * tell afterwards which difference was the tidying and which was the accident.
 *
 * So `caption` is 11px because footers were 11px, and `label` is 12px because selects were 12px.
 * Consolidating 12 into 13 is worth doing once somebody can look at it and decide, and that is a
 * separate change from naming the values we already had.
 *
 * ## Density is not type
 *
 * Density changes room — control heights, padding, gaps — and never font size. A phone that
 * raises the system font scale *and* a density that raises type would multiply, and 1.3 scale at
 * an already-large type size is a layout nobody measured. The system owns type size; this owns
 * space.
 *
 * ## Radius, elevation and motion wear Tailwind's names
 *
 * Since Tailwind 4 a utility reads a custom property: `rounded-md` is
 * `border-radius: var(--radius-md)`, `shadow-xl` is `box-shadow: var(--shadow-xl)`. So the names
 * here are Tailwind's, not new vocabulary — publishing the record on `:root` is what lets a host
 * reach a pack's utilities across an origin, and the values are Tailwind's defaults exactly so
 * that doing it changes no pixel. A step nothing reads is not added: `--radius-full` is absent
 * because `rounded-full` compiles to `calc(infinity * 1px)` rather than to a variable.
 *
 * Motion is the exception, because Tailwind has no per-use duration variable to override. The
 * durations are named for the job instead, and `base` is the 150ms a `transition-colors` already
 * runs at.
 */
export declare const TYPE_ROLES: readonly ["caption", "label", "body", "title", "display"];
export type TypeRole = (typeof TYPE_ROLES)[number];
export interface TypeStep {
    readonly size: string;
    readonly lineHeight: string;
}
/** The sizes that shipped, with line heights that were previously implicit. */
export declare const TYPE_SCALE: Readonly<Record<TypeRole, TypeStep>>;
/**
 * The density names, which are not ours.
 *
 * `@suite/go` already publishes `ThemeDensity` with these three values in `ModuleHost`, so
 * reusing them means neither side has to translate. A fourth name would have been a fork with
 * extra steps.
 */
export declare const DENSITIES: readonly ["compact", "cozy", "comfortable"];
export type Density = (typeof DENSITIES)[number];
/** The one place the three density choices are written for people rather than code. */
export declare const DENSITY_LABELS: Record<Density, string>;
export interface DensityMetrics {
    /** A full-size control: a primary button, a field. */
    readonly controlHeight: string;
    /** The small variant. */
    readonly controlHeightSmall: string;
    readonly controlPaddingX: string;
    readonly controlPaddingXSmall: string;
    readonly controlGap: string;
    readonly controlGapSmall: string;
    /** Vertical padding of a list row, such as a recent document. */
    readonly rowPaddingY: string;
}
/**
 * `cozy` is what shipped, exactly: a 36px button with 12px of side padding.
 *
 * That is the default, so adopting these tokens changes no desktop pixel. `comfortable` is the
 * one a touch host picks, and its 44px control height is the number mobile accessibility asks
 * for rather than a taste.
 */
export declare const DENSITY_SCALE: Readonly<Record<Density, DensityMetrics>>;
export declare const DEFAULT_DENSITY: Density;
/** The custom property a type step publishes, and its line height. */
export declare function typeVariableFor(role: TypeRole): {
    size: string;
    lineHeight: string;
};
/** Every type step as custom properties. */
export declare function typeVariables(): Readonly<Record<string, string>>;
/** Every density metric as a custom property. */
export declare function densityVariables(density: Density): Readonly<Record<string, string>>;
/**
 * The corner steps the apps draw with.
 *
 * `md`, `lg` and `xl` are the three Budget uses — 61, 19 and 16 call sites — and `sm` is here
 * because a chip or an input already reaches for it. The values are Tailwind's
 * (`--radius-sm: .25rem` … `--radius-xl: .75rem`) at the 16px root the apps render at, which is
 * why adopting this record moves no corner.
 */
export declare const RADIUS_ROLES: readonly ["sm", "md", "lg", "xl"];
export type RadiusRole = (typeof RADIUS_ROLES)[number];
export declare const RADIUS_SCALE: Readonly<Record<RadiusRole, string>>;
/**
 * Elevation, in the two steps the tree draws with.
 *
 * `xl` is the raised step — a menu, a popover, a sticky header — and Budget uses `shadow-xl`
 * eight times; `2xl` is the overlay step, one dialog. Both values are Tailwind's, so a host that
 * publishes them renders what shipped, and a preset that wants a different depth changes one
 * record instead of hunting class names in six apps.
 */
export declare const SHADOW_ROLES: readonly ["xl", "2xl"];
export type ShadowRole = (typeof SHADOW_ROLES)[number];
export declare const SHADOW_SCALE: Readonly<Record<ShadowRole, string>>;
/**
 * Three durations and the one curve, for the transitions Tailwind does not name.
 *
 * `base` is 150ms because that is Tailwind's `--default-transition-duration` and therefore what
 * every `transition-colors` in the primitives already runs at; `fast` and `slow` are the steps
 * around it. `standard` is Tailwind's default timing function, so nothing eases differently
 * until somebody decides it should.
 */
export declare const DURATIONS: readonly ["fast", "base", "slow"];
export type Duration = (typeof DURATIONS)[number];
export declare const DURATION_SCALE: Readonly<Record<Duration, string>>;
export declare const EASE_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)";
/** Every radius step as a custom property. */
export declare function radiusVariables(): Readonly<Record<string, string>>;
/** Every elevation as a custom property. */
export declare function shadowVariables(): Readonly<Record<string, string>>;
/** Every duration, plus the one curve, as custom properties. */
export declare function motionVariables(): Readonly<Record<string, string>>;
/**
 * The whole second axis as one record: type, density, radius, elevation and motion.
 *
 * A host publishes this once and every utility in a pack follows — the same shape as
 * `cssVariables` for colour, and for the same reason: one answer, injected, rather than each
 * view deciding. The layers stay separate functions so a caller that wants radius without
 * density can still ask for it.
 */
export declare function scaleVariables(density: Density): Readonly<Record<string, string>>;
/**
 * Publish the scale on an element.
 *
 * Separate from `applyTheme` rather than folded into it, because the two answer different
 * questions and a call site may reasonably want a theme without touching density. Every
 * primitive reads these with a fallback equal to what shipped, so a document that never calls
 * this renders exactly as it did.
 */
export declare function applyScale(density: Density, target: Paintable): void;
//# sourceMappingURL=scale.d.ts.map