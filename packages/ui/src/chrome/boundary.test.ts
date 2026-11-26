import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Host chrome stays out of a pack.
 *
 * `HostTabBar` and `NewTabPicker` draw the window a host owns. A pack that imported them could
 * draw a second bar, or depend on a surface its host does not offer. The root `@suite/ui` entry
 * no longer exports them at all — the subpath is the only door — and this guard makes sure a pack
 * never walks through it, in any import form.
 */
const SKIP = new Set(["node_modules", ".dev", "dist", "storybook-static", ".git"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIP.has(entry.name) ? [] : sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

/** Find `packs/` by walking up, so the guard does not depend on the caller's cwd. */
function packsDirectory(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let step = 0; step < 8; step += 1) {
    const candidate = join(directory, "packs");
    if (existsSync(candidate)) return candidate;
    directory = dirname(directory);
  }
  throw new Error("packs/ was not found above the ui package");
}

const CHROME_SUBPATH = /["']@suite\/ui\/chrome["']/u;
const HOST_NAME =
  /\b(?:HostTabBar|HostTab|HostTabKind|HostTabBarProps|NewTabPicker|NewTabPickerProps|NewTabPack|NewTabScreen|OpenDocumentRef)\b/u;
const ROOT_IMPORT = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@suite\/ui["']/gu;

/** Every way a pack source file could reach host chrome. */
export function violationsIn(source: string): string[] {
  const found: string[] = [];
  if (CHROME_SUBPATH.test(source)) found.push("references @suite/ui/chrome");
  for (const match of source.matchAll(ROOT_IMPORT)) {
    if (HOST_NAME.test(match[1] ?? "")) {
      found.push(`imports host chrome from @suite/ui: ${match[0].trim()}`);
    }
  }
  return found;
}

describe("the pack surface", () => {
  it("never reaches host chrome", () => {
    const root = packsDirectory();
    const violations: string[] = [];

    for (const file of sourceFiles(root)) {
      for (const violation of violationsIn(readFileSync(file, "utf8"))) {
        violations.push(`${file.replace(`${root}/`, "packs/")}: ${violation}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("the boundary guard", () => {
  it("sees every import form, not just a named import", () => {
    expect(violationsIn('import { HostTabBar } from "@suite/ui";')).toHaveLength(1);
    expect(violationsIn('import type { HostTab } from "@suite/ui";')).toHaveLength(1);
    expect(violationsIn('export { NewTabPicker } from "@suite/ui";')).toHaveLength(1);
    expect(violationsIn('import * as chrome from "@suite/ui/chrome";')).toHaveLength(1);
    expect(violationsIn('const chrome = await import("@suite/ui/chrome");')).toHaveLength(1);
    expect(violationsIn('export * from "@suite/ui/chrome";')).toHaveLength(1);
    expect(violationsIn('import { AppShell, Button } from "@suite/ui";')).toHaveLength(0);
  });
});
