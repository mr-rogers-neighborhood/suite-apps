import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tokens only, never literals.
 *
 * The contrast test proves the colour pairs a component uses are readable. This one proves
 * the component reaches those pairs through a custom property at all: a `bg-black/30` or a
 * hand-picked `rounded-[9px]` would pass every other test while ignoring the preset the host
 * actually published. Comments are stripped first, because the components' own documentation
 * is allowed to name the bug it replaced.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    if (!/\.(?:ts|tsx)$/u.test(entry.name)) return [];
    if (/\.(?:test|stories)\.tsx?$/u.test(entry.name) || entry.name === "testSetup.ts") return [];
    return [path];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

const PALETTE = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
].join("|");
const COLOUR_UTILITIES =
  "bg|text|border|ring|fill|stroke|outline|decoration|from|via|to|divide|caret|accent|placeholder";

const RULES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "a hex colour", pattern: /#[0-9a-f]{3,8}\b/giu },
  {
    name: "a colour function",
    pattern: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/giu,
  },
  {
    name: "a white/black utility",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/giu,
  },
  {
    name: "a Tailwind palette utility",
    pattern: new RegExp(
      `\\b(?:${COLOUR_UTILITIES})-(?:${PALETTE})(?:-\\d{2,3})?\\b`,
      "giu",
    ),
  },
  { name: "an unpublished radius step", pattern: /\brounded-(?:2xl|3xl|4xl)|rounded-\[\d/giu },
  // Tailwind compiles bare `rounded` to a static `0.25rem` and bare `shadow` to a literal rgb
  // pair; neither follows the published `--radius-*`/`--shadow-*` steps.
  { name: "a bare radius utility", pattern: /(?<![\w-])rounded(?![\w-])/gu },
  { name: "a bare shadow utility", pattern: /(?<![\w-])shadow(?![\w-])/gu },
  {
    name: "an unpublished shadow step",
    pattern: /\bshadow-(?:2xs|xs|sm|md|lg|inner)\b/giu,
  },
  // Tailwind's `shadow-xl`/`shadow-2xl` utilities bake in their own values; only the
  // package's `var(--shadow-*)` form follows the published layer.
  { name: "an unbound shadow step", pattern: /(?:^|[\s"'])shadow-(?:xl|2xl)\b/gmu },
  {
    name: "an arbitrary shadow without a token",
    pattern: /\bshadow-\[(?![^\]]*var\()[^\]]*\]/giu,
  },
  // `transition-colors` alone bakes in Tailwind's static 150ms. Every transition utility must
  // carry the published duration in its class list; `transition-none` animates nothing.
  {
    name: "a transition without a token duration",
    pattern: /(?<![\w-])transition(?!-none\b)(?:-[a-z]+)?(?![^"'`\n]*duration-\[var\()/gu,
  },
  { name: "a literal duration", pattern: /\bduration-(?:\d+|\[\d)/giu },
] as const;

interface Violation {
  readonly rule: string;
  readonly value: string;
}

/** Every rule the source violates, with the value that matched. */
function violationsIn(source: string): readonly Violation[] {
  const clean = withoutComments(source);
  return RULES.flatMap((rule) =>
    (clean.match(rule.pattern) ?? []).map((value) => ({ rule: rule.name, value })),
  );
}

describe("tokens only", () => {
  it("never hardcodes a colour, radius, shadow or duration in a component", () => {
    const root = join(process.cwd(), "src");
    for (const file of sourceFiles(root)) {
      const found = violationsIn(readFileSync(file, "utf8"));
      expect(
        found,
        `${file.replace(`${root}/`, "src/")} uses ${found
          .map(({ rule, value }) => `${rule} (${value})`)
          .join(", ")}`,
      ).toEqual([]);
    }
  });
});

/** One case per form the guard must keep catching as the matcher widens. */
const FORMS = [
  { name: "hex", source: 'className="bg-[#fff]"', value: "#fff" },
  { name: "rgb()", source: 'className="bg-[rgb(0_0_0)]"', value: "rgb(" },
  { name: "hsl()", source: 'className="text-[hsl(200_50%_50%)]"', value: "hsl(" },
  { name: "hwb()", source: 'className="text-[hwb(20_50%_50%)]"', value: "hwb(" },
  { name: "lab()", source: 'className="bg-[lab(50%_40_59)]"', value: "lab(" },
  { name: "lch()", source: 'className="bg-[lch(50%_40_30)]"', value: "lch(" },
  { name: "oklab()", source: 'className="bg-[oklab(0.7_0.1_0.2)]"', value: "oklab(" },
  { name: "oklch()", source: 'className="bg-[oklch(0.7_0.1_200)]"', value: "oklch(" },
  {
    name: "color()",
    source: 'className="bg-[color(display-p3_1_0_0)]"',
    value: "color(",
  },
  { name: "Tailwind palette background", source: 'className="bg-red-500"', value: "bg-red-500" },
  { name: "Tailwind palette text", source: 'className="text-slate-400"', value: "text-slate-400" },
  {
    name: "Tailwind palette border",
    source: 'className="border-zinc-700"',
    value: "border-zinc-700",
  },
  { name: "shadow-xs", source: 'className="shadow-xs"', value: "shadow-xs" },
  { name: "shadow-2xs", source: 'className="shadow-2xs"', value: "shadow-2xs" },
  {
    name: "arbitrary non-rgb shadow",
    source: 'className="shadow-[0_10px_20px_currentColor]"',
    value: "shadow-[0_10px_20px_currentColor]",
  },
  {
    name: "bare transition-colors",
    source: 'className="transition-colors"',
    value: "transition-colors",
  },
  { name: "bare rounded", source: 'className="rounded"', value: "rounded" },
  { name: "bare shadow", source: 'className="shadow"', value: "shadow" },
  { name: "bare transition", source: 'className="transition"', value: "transition" },
  {
    name: "transition-opacity without a token duration",
    source: 'className="transition-opacity"',
    value: "transition-opacity",
  },
  {
    name: "transition-transform without a token duration",
    source: 'className="transition-transform"',
    value: "transition-transform",
  },
] as const;

describe("the matcher", () => {
  it.each(FORMS)("catches $name", ({ source, value }) => {
    expect(violationsIn(source).map((violation) => violation.value).join(" ")).toContain(value);
  });

  it("allows the token-bound forms the components use", () => {
    const source = [
      'className="bg-[var(--accent)] text-[var(--ink)]"',
      'className="shadow-[var(--shadow-2xl)]"',
      'className="shadow-[inset_0_-1px_0_var(--hairline)]"',
      'className="transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)]"',
      'className="transition-opacity duration-[var(--duration-base)]"',
      'className="transition-transform duration-[var(--duration-base)]"',
      'className="rounded-full rounded-sm shadow-none transition-none"',
    ].join("\n");

    expect(violationsIn(source)).toEqual([]);
  });
});
