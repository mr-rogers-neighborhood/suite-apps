/**
 * Warm — warm paper, near-black ink and one burnt-orange accent.
 *
 * The palette borrows Sunsama's warm paper field and the Heptabase habit of letting one warm
 * mark carry the action. The six hues stay distinguishable for sections and charts; they are
 * muted so the accent is still the loudest colour on the page. The light variant is paper, not
 * white, so the two modes read as one theme.
 *
 * The id used to be `logseq`. `THEME_ID_ALIASES` keeps an existing stored selection on this
 * id rather than on a missing theme.
 */
export const warm = {
    format: "suite.theme",
    contractVersion: 1,
    id: "warm",
    name: "Warm",
    description: "Warm paper, near-black ink and one burnt-orange accent.",
    light: {
        canvas: "#f6f1e9",
        surface: "#fffcf7",
        "surface-sunk": "#ece4d8",
        "surface-strong": "#fff7ec",
        accent: "#b54a22",
        "accent-strong": "#963716",
        danger: "#a83228",
        success: "#3f6b3a",
        warning: "#8a5a12",
        ink: "#211d18",
        "ink-muted": "#5e574e",
        "ink-faint": "#6d6459",
        hairline: "#e4dacb",
        "border-strong": "#8a7f70",
        focus: "#b54a22",
        "on-accent": "#fffaf3",
        "on-danger": "#fffaf3",
        "on-success": "#fffaf3",
        "on-warning": "#fffaf3",
        "hue-slate": "#6f6a63",
        "hue-blue": "#2f6f9f",
        "hue-green": "#3f6b3a",
        "hue-amber": "#a05a10",
        "hue-rose": "#a33a4e",
        "hue-violet": "#6b5490",
        "chart-1": "#b54a22",
        "chart-2": "#3f6b3a",
        "chart-3": "#a05a10",
        "chart-4": "#6b5490",
        "chart-5": "#a33a4e",
    },
    dark: {
        canvas: "#171411",
        surface: "#201c18",
        "surface-sunk": "#100e0b",
        "surface-strong": "#2a251f",
        accent: "#e8a87c",
        "accent-strong": "#f2c39e",
        danger: "#f0a19a",
        success: "#9ccf9e",
        warning: "#e8c27a",
        ink: "#f4eee6",
        "ink-muted": "#b9b0a3",
        "ink-faint": "#9f9587",
        hairline: "#342e27",
        "border-strong": "#8a8072",
        focus: "#e8a87c",
        "on-accent": "#1a1511",
        "on-danger": "#171411",
        "on-success": "#171411",
        "on-warning": "#171411",
        "hue-slate": "#a79d8f",
        "hue-blue": "#8db8d9",
        "hue-green": "#9ccf9e",
        "hue-amber": "#e8b87a",
        "hue-rose": "#e7a0a6",
        "hue-violet": "#c0a6e0",
        "chart-1": "#e8a87c",
        "chart-2": "#9ccf9e",
        "chart-3": "#e8b87a",
        "chart-4": "#c0a6e0",
        "chart-5": "#e7a0a6",
    },
};
//# sourceMappingURL=warm.js.map