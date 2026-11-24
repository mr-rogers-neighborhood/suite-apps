import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESETS } from "@suite/theme";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_CHOICE,
  isHostThemeChoice,
  isThemeSource,
  loadThemeChoice,
  paintThemeSurface,
  presetFor,
  resolveMode,
  resolveThemeView,
  saveThemeChoice,
  themeAttributesScript,
  themeCss,
  themeOptions,
} from "./theme.js";

const roots: string[] = [];

async function profileRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-shell-theme-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("theme choice", () => {
  it("starts on Suite, following the desktop", async () => {
    expect(await loadThemeChoice(await profileRoot())).toEqual(DEFAULT_THEME_CHOICE);
    expect(DEFAULT_THEME_CHOICE).toEqual({ preset: "suite", mode: "system" });
  });

  it("writes what it read, under the host profile", async () => {
    const root = await profileRoot();
    await saveThemeChoice(root, { preset: "warm", mode: "dark" });
    expect(await loadThemeChoice(root)).toEqual({ preset: "warm", mode: "dark" });
    expect(JSON.parse(await readFile(join(root, "theme.json"), "utf8"))).toEqual({
      preset: "warm",
      mode: "dark",
    });
  });

  it("maps a stored logseq selection to Warm instead of a missing theme", async () => {
    const root = await profileRoot();
    await writeFile(join(root, "theme.json"), JSON.stringify({ preset: "logseq", mode: "dark" }));
    expect(await loadThemeChoice(root)).toEqual({ preset: "warm", mode: "dark" });
  });

  it("keeps the mode from a record written before presets existed", async () => {
    const root = await profileRoot();
    await writeFile(join(root, "theme.json"), JSON.stringify({ mode: "light" }));
    expect(await loadThemeChoice(root)).toEqual({ preset: "suite", mode: "light" });
  });

  it("answers the default for a file it cannot read", async () => {
    const root = await profileRoot();
    await writeFile(join(root, "theme.json"), "not json at all");
    expect(await loadThemeChoice(root)).toEqual(DEFAULT_THEME_CHOICE);
  });

  it("falls back for a preset this build does not ship", () => {
    expect(presetFor("solarized")).toBe("solarized");
    expect(presetFor("logseq")).toBe("warm");
    expect(presetFor("some-future-theme")).toBe("suite");
    expect(presetFor(null)).toBe("suite");
  });

  it("accepts only the three brightness choices", () => {
    expect(isThemeSource("system")).toBe(true);
    expect(isThemeSource("sepia")).toBe(false);
    expect(isHostThemeChoice({ preset: "suite", mode: "system" })).toBe(true);
    expect(isHostThemeChoice({ preset: "suite", mode: "sepia" })).toBe(false);
    expect(isHostThemeChoice("dark")).toBe(false);
  });

  it("offers the package's three names in the package's order", () => {
    expect(themeOptions()).toEqual([...PRESETS]);
    expect(themeOptions().map((theme) => theme.name)).toEqual(["Suite", "Warm", "Solarized"]);
  });
});

describe("resolving the choice", () => {
  it("follows the desktop for system and obeys an explicit choice", () => {
    expect(resolveMode({ preset: "suite", mode: "system" }, true)).toBe("dark");
    expect(resolveMode({ preset: "suite", mode: "system" }, false)).toBe("light");
    expect(resolveMode({ preset: "suite", mode: "light" }, true)).toBe("light");
    expect(resolveMode({ preset: "suite", mode: "dark" }, false)).toBe("dark");
  });

  it("paints every role as a variable, with a resolved preset id", () => {
    const view = resolveThemeView({ preset: "logseq", mode: "system" }, true);
    expect(view.preset).toBe("warm");
    expect(view.mode).toBe("dark");
    expect(view.values["--canvas"]).toBeTruthy();
    expect(view.values["--ink"]).toBeTruthy();
  });

  it("falls back to Suite when the stored preset is unknown", () => {
    expect(resolveThemeView({ preset: "neon", mode: "light" }, false).preset).toBe("suite");
  });

  it("stores the resolved preset in the stylesheet a pack receives", () => {
    const css = themeCss(resolveThemeView({ preset: "warm", mode: "light" }, false));
    expect(css.startsWith(":root { color-scheme: light;")).toBe(true);
    expect(css).toContain("--canvas:");
    expect(css).toContain("--ink:");
  });

  it("marks the pack document dark so class-based styles follow the host", () => {
    const script = themeAttributesScript(
      resolveThemeView({ preset: "solarized", mode: "dark" }, true),
    );
    expect(script).toContain('root.dataset.theme = "solarized";');
    expect(script).toContain('root.dataset.themeMode = "dark";');
    expect(script).toContain('root.classList.toggle("dark", true);');
    expect(script).toContain('root.style.colorScheme = "dark";');
  });
});

describe("painting a pack view", () => {
  it("replaces the previous sheet when the host changes theme", async () => {
    // The seam ShellWindow.setTheme uses: a pack that is already open receives the new
    // variables and attributes immediately, and its old stylesheet is removed.
    const inserted: string[] = [];
    const scripts: string[] = [];
    const removed: string[] = [];
    let nextKey = 0;
    const surface = {
      insertCSS: vi.fn(async (css: string) => {
        inserted.push(css);
        nextKey += 1;
        return `sheet-${nextKey}`;
      }),
      executeJavaScript: vi.fn(async (script: string) => {
        scripts.push(script);
      }),
      removeInsertedCSS: vi.fn(async (key: string) => {
        removed.push(key);
      }),
    };

    const first = await paintThemeSurface(
      surface,
      resolveThemeView({ preset: "warm", mode: "dark" }, true),
    );
    expect(first).toBe("sheet-1");

    const second = await paintThemeSurface(
      surface,
      resolveThemeView({ preset: "suite", mode: "light" }, false),
      first,
    );

    expect(second).toBe("sheet-2");
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toContain("--canvas:");
    expect(inserted[0]).toContain("color-scheme: dark");
    expect(inserted[1]).toContain("color-scheme: light");
    expect(inserted[1]).not.toBe(inserted[0]);
    expect(scripts[1]).toContain('root.dataset.themeMode = "light";');
    expect(scripts[1]).toContain('root.classList.toggle("dark", false);');
    expect(removed).toEqual(["sheet-1"]);
  });

  it("keeps the new sheet when Electron reuses a key", async () => {
    const surface = {
      insertCSS: vi.fn(async () => "same-key"),
      executeJavaScript: vi.fn(async () => undefined),
      removeInsertedCSS: vi.fn(async () => undefined),
    };
    const key = await paintThemeSurface(
      surface,
      resolveThemeView({ preset: "suite", mode: "dark" }, true),
      "same-key",
    );
    expect(key).toBe("same-key");
    expect(surface.removeInsertedCSS).not.toHaveBeenCalled();
  });
});
