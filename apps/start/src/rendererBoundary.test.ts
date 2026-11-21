import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The page never learns a second way to reach a package.
 *
 * The renderer is plain ES modules served over `start://`, with no bundler and no
 * Node integration. It may only import its own sibling modules and ask main over
 * `suiteStart`. A future packaged-as-Flatpak Start can therefore change one backend
 * without the page changing at all: there is no `child_process`, no `flatpak` module
 * and no process spawn to find here.
 */

const RENDERER = resolve(dirname(fileURLToPath(import.meta.url)), "renderer");
const FORBIDDEN =
  /node:child_process|from\s+["'][^"']*child_process|from\s+["'][^"']*flatpak|require\s*\(|execFile\s*\(|\bspawn\s*\(|\bexecSync\s*\(/u;

async function rendererFiles(): Promise<readonly string[]> {
  const names = await readdir(RENDERER, { recursive: true });
  return names.filter((name) => /\.(?:c|m)?js$/u.test(name)).map((name) => join(RENDERER, name));
}

describe("the renderer boundary", () => {
  it("imports no child_process, no flatpak module and starts no process", async () => {
    const files = await rendererFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect({ file: relative(RENDERER, file), match: text.match(FORBIDDEN)?.[0] ?? null }).toEqual(
        {
          file: relative(RENDERER, file),
          match: null,
        },
      );
    }
  });

  it("resolves every import inside the renderer directory", async () => {
    for (const file of await rendererFiles()) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/from\s+["']([^"']+)["']/gu)) {
        const specifier = match[1] ?? "";
        expect(specifier.startsWith("./")).toBe(true);
        const target = resolve(dirname(file), specifier);
        expect(relative(RENDERER, target).startsWith("..")).toBe(false);
      }
    }
  });

  it("keeps the catalogue free of the native package modules too", async () => {
    const text = await readFile(join(dirname(RENDERER), "catalogue.ts"), "utf8");
    expect(text).not.toMatch(/child_process|from\s+["'][^"']*flatpak|\bspawn\s*\(/u);
  });
});
