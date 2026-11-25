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
export const TYPE_ROLES = ["caption", "label", "body", "title", "display"];
/** The sizes that shipped, with line heights that were previously implicit. */
export const TYPE_SCALE = {
    caption: { size: "11px", lineHeight: "15px" },
    label: { size: "12px", lineHeight: "16px" },
    body: { size: "13px", lineHeight: "20px" },
    title: { size: "15px", lineHeight: "22px" },
    display: { size: "34px", lineHeight: "40px" },
};
/**
 * The density names, which are not ours.
 *
 * `@suite/go` already publishes `ThemeDensity` with these three values in `ModuleHost`, so
 * reusing them means neither side has to translate. A fourth name would have been a fork with
 * extra steps.
 */
export const DENSITIES = ["compact", "cozy", "comfortable"];
/**
 * `cozy` is what shipped, exactly: a 36px button with 12px of side padding.
 *
 * That is the default, so adopting these tokens changes no desktop pixel. `comfortable` is the
 * one a touch host picks, and its 44px control height is the number mobile accessibility asks
 * for rather than a taste.
 */
export const DENSITY_SCALE = {
    compact: {
        controlHeight: "32px",
        controlHeightSmall: "28px",
        controlPaddingX: "10px",
        controlPaddingXSmall: "8px",
        controlGap: "6px",
        controlGapSmall: "4px",
        rowPaddingY: "8px",
    },
    cozy: {
        controlHeight: "36px",
        controlHeightSmall: "32px",
        controlPaddingX: "12px",
        controlPaddingXSmall: "10px",
        controlGap: "8px",
        controlGapSmall: "6px",
        rowPaddingY: "10px",
    },
    comfortable: {
        controlHeight: "44px",
        controlHeightSmall: "40px",
        controlPaddingX: "16px",
        controlPaddingXSmall: "12px",
        controlGap: "10px",
        controlGapSmall: "8px",
        rowPaddingY: "14px",
    },
};
export const DEFAULT_DENSITY = "cozy";
/** The custom property a type step publishes, and its line height. */
export function typeVariableFor(role) {
    return { size: `--text-${role}`, lineHeight: `--leading-${role}` };
}
/** Every type step as custom properties. */
export function typeVariables() {
    const out = {};
    for (const role of TYPE_ROLES) {
        const names = typeVariableFor(role);
        out[names.size] = TYPE_SCALE[role].size;
        out[names.lineHeight] = TYPE_SCALE[role].lineHeight;
    }
    return out;
}
/** Every density metric as a custom property. */
export function densityVariables(density) {
    const metrics = DENSITY_SCALE[density];
    return {
        "--control-height": metrics.controlHeight,
        "--control-height-sm": metrics.controlHeightSmall,
        "--control-padding-x": metrics.controlPaddingX,
        "--control-padding-x-sm": metrics.controlPaddingXSmall,
        "--control-gap": metrics.controlGap,
        "--control-gap-sm": metrics.controlGapSmall,
        "--row-padding-y": metrics.rowPaddingY,
    };
}
/**
 * The corner steps the apps draw with.
 *
 * `md`, `lg` and `xl` are the three Budget uses — 61, 19 and 16 call sites — and `sm` is here
 * because a chip or an input already reaches for it. The values are Tailwind's
 * (`--radius-sm: .25rem` … `--radius-xl: .75rem`) at the 16px root the apps render at, which is
 * why adopting this record moves no corner.
 */
export const RADIUS_ROLES = ["sm", "md", "lg", "xl"];
export const RADIUS_SCALE = {
    sm: "4px",
    md: "6px",
    lg: "8px",
    xl: "12px",
};
/**
 * Elevation, in the two steps the tree draws with.
 *
 * `xl` is the raised step — a menu, a popover, a sticky header — and Budget uses `shadow-xl`
 * eight times; `2xl` is the overlay step, one dialog. Both values are Tailwind's, so a host that
 * publishes them renders what shipped, and a preset that wants a different depth changes one
 * record instead of hunting class names in six apps.
 */
export const SHADOW_ROLES = ["xl", "2xl"];
export const SHADOW_SCALE = {
    xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
};
/**
 * Three durations and the one curve, for the transitions Tailwind does not name.
 *
 * `base` is 150ms because that is Tailwind's `--default-transition-duration` and therefore what
 * every `transition-colors` in the primitives already runs at; `fast` and `slow` are the steps
 * around it. `standard` is Tailwind's default timing function, so nothing eases differently
 * until somebody decides it should.
 */
export const DURATIONS = ["fast", "base", "slow"];
export const DURATION_SCALE = {
    fast: "100ms",
    base: "150ms",
    slow: "240ms",
};
export const EASE_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)";
/** Every radius step as a custom property. */
export function radiusVariables() {
    const out = {};
    for (const role of RADIUS_ROLES)
        out[`--radius-${role}`] = RADIUS_SCALE[role];
    return out;
}
/** Every elevation as a custom property. */
export function shadowVariables() {
    const out = {};
    for (const role of SHADOW_ROLES)
        out[`--shadow-${role}`] = SHADOW_SCALE[role];
    return out;
}
/** Every duration, plus the one curve, as custom properties. */
export function motionVariables() {
    const out = {};
    for (const duration of DURATIONS)
        out[`--duration-${duration}`] = DURATION_SCALE[duration];
    out["--ease-standard"] = EASE_STANDARD;
    return out;
}
/**
 * The whole second axis as one record: type, density, radius, elevation and motion.
 *
 * A host publishes this once and every utility in a pack follows — the same shape as
 * `cssVariables` for colour, and for the same reason: one answer, injected, rather than each
 * view deciding. The layers stay separate functions so a caller that wants radius without
 * density can still ask for it.
 */
export function scaleVariables(density) {
    return {
        ...typeVariables(),
        ...densityVariables(density),
        ...radiusVariables(),
        ...shadowVariables(),
        ...motionVariables(),
    };
}
/**
 * Publish the scale on an element.
 *
 * Separate from `applyTheme` rather than folded into it, because the two answer different
 * questions and a call site may reasonably want a theme without touching density. Every
 * primitive reads these with a fallback equal to what shipped, so a document that never calls
 * this renders exactly as it did.
 */
export function applyScale(density, target) {
    for (const [name, value] of Object.entries(scaleVariables(density))) {
        target.style.setProperty(name, value);
    }
    if (target.dataset !== undefined)
        target.dataset.density = density;
}
//# sourceMappingURL=scale.js.map