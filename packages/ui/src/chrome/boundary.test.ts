import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Host chrome stays out of a pack.
 *
 * `HostTabBar` and `NewTabPicker` draw the window a host owns. A pack that imported them could
 * draw a second bar, or depend on a surface its host does not offer. The package exposes them at
 * `@suite/ui/chrome`; this guard makes the boundary real rather than a convention.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", ".dev", "dist", "storybook-static"].includes(entry.name)
        ? []
        : sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

const HOST_ONLY = /\b(?:HostTabBar|NewTabPicker|HostTab|NewTabPack|NewTabScreen)\b/u;

describe("the pack surface", () => {
  it("never imports host chrome from @suite/ui", () => {
    const root = join(process.cwd(), "..", "..", "packs");
    const violations: string[] = [];

    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      const imports = source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@suite\/ui(?:\/chrome)?["']/gu,
      );
      for (const match of imports) {
        if (HOST_ONLY.test(match[1] ?? "")) {
          violations.push(`${file.replace(`${root}/`, "packs/")}: ${match[0].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
