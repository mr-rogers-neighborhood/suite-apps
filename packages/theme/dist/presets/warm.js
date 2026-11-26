/**
 * Warm — warm charcoal, amber accent.
 *
 * Not a copy of Logseq's stylesheet, and named for the resemblance rather than the source: a
 * warm near-neutral background with a single amber accent is the thing being borrowed, not
 * specific hex values. Suite is warm paper now, so this is the charcoal-and-amber variant: the
 * same warmth after dark, with a deeper ink and a brighter accent.
 *
 * The id used to be `logseq`, after the app it resembles. The display name was always "Warm",
 * so the id now agrees with the name; `THEME_ID_ALIASES` in `./index.ts` keeps an existing
 * stored selection on this palette rather than on a missing theme.
 *
 * The light variant is the same warmth at daylight: a paper tone rather than white, so the
 * two modes read as one theme instead of a dark theme with a light fallback.
 */
export const warm = {
    format: "suite.theme",
    contractVersion: 1,
    id: "warm",
    name: "Warm",
    description: "Warm charcoal and amber, in the spirit of Logseq's default dark.",
    light: {
        canvas: "#f5f4f1",
        surface: "#fbfaf8",
        "surface-sunk": "#efeee9",
        "surface-strong": "#ffffff",
        accent: "#b45309",
        "accent-strong": "#92400e",
        danger: "#a5231b",
        success: "#3f6212",
        warning: "#8a5300",
        ink: "#1f1e1c",
        "ink-muted": "#5a5751",
        "ink-faint": "#6e6a63",
        hairline: "#e2e0d8",
        "border-strong": "#888888",
        focus: "#b45309",
        "on-accent": "#fffaf3",
        "on-danger": "#fffaf3",
        "on-success": "#fffaf3",
        "on-warning": "#fffaf3",
        "hue-slate": "#6b6257",
        "hue-blue": "#2563a8",
        "hue-green": "#3f6212",
        "hue-amber": "#b45309",
        "hue-rose": "#a13a5c",
        "hue-violet": "#6b4fa8",
        "chart-1": "#b45309",
        "chart-2": "#3f6212",
        "chart-3": "#2563a8",
        "chart-4": "#6b4fa8",
        "chart-5": "#a13a5c",
    },
    dark: {
        canvas: "#191918",
        surface: "#222220",
        "surface-sunk": "#141413",
        "surface-strong": "#2a2a27",
        accent: "#e0913f",
        "accent-strong": "#edaa63",
        danger: "#e57368",
        success: "#a3b86c",
        warning: "#d9a441",
        ink: "#e8e5df",
        "ink-muted": "#a8a29a",
        "ink-faint": "#96918a",
        hairline: "#33322e",
        "border-strong": "#737373",
        focus: "#e0913f",
        "on-accent": "#191918",
        "on-danger": "#191918",
        "on-success": "#191918",
        "on-warning": "#191918",
        "hue-slate": "#a29a8e",
        "hue-blue": "#7fb2e8",
        "hue-green": "#a3b86c",
        "hue-amber": "#e0913f",
        "hue-rose": "#e08a9e",
        "hue-violet": "#b49ce8",
        "chart-1": "#e0913f",
        "chart-2": "#a3b86c",
        "chart-3": "#7fb2e8",
        "chart-4": "#b49ce8",
        "chart-5": "#e08a9e",
    },
};
//# sourceMappingURL=warm.js.map