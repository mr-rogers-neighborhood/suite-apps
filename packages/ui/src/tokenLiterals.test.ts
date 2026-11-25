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

const RULES = [
  { name: "a hex colour", pattern: /#[0-9a-f]{3,8}\b/giu },
  { name: "an rgb()/hsl() colour", pattern: /\b(?:rgba?|hsla?)\(/giu },
  {
    name: "a white/black utility",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/giu,
  },
  { name: "an unpublished radius step", pattern: /\brounded-(?:2xl|3xl)|rounded-\[\d/giu },
  { name: "an unpublished shadow step", pattern: /\bshadow-(?:sm|md|lg|inner)\b/giu },
  // Tailwind's `shadow-xl`/`shadow-2xl` utilities bake in their own values; only the
  // package's `shadow-[var(--shadow-*)]` form follows the published layer.
  { name: "an unbound shadow step", pattern: /(?:^|[\s"'])shadow-(?:xl|2xl)\b/gmu },
  { name: "a literal duration", pattern: /\bduration-(?:\d+|\[\d)/giu },
] as const;

describe("tokens only", () => {
  it("never hardcodes a colour, radius, shadow or duration in a component", () => {
    const root = join(process.cwd(), "src");
    for (const file of sourceFiles(root)) {
      const source = withoutComments(readFileSync(file, "utf8"));
      for (const rule of RULES) {
        const matches = source.match(rule.pattern) ?? [];
        expect(
          matches,
          `${file.replace(`${root}/`, "src/")} uses ${rule.name}: ${matches.join(", ")}`,
        ).toEqual([]);
      }
    }
  });
});
