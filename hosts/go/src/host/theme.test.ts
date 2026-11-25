import { describe, expect, it } from "vitest";
import {
  DEFAULT_GO_THEME_CHOICE,
  isGoThemeChoice,
  isThemeSource,
  presetFor,
  readThemeChoice,
  resolveMode,
  tokensFor,
} from "./theme.js";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    read: (key: string) => values.get(key) ?? null,
  };
}

describe("the host profile's theme choice", () => {
  it("follows the phone with Suite until someone says otherwise", () => {
    expect(readThemeChoice(memory())).toEqual(DEFAULT_GO_THEME_CHOICE);
    expect(DEFAULT_GO_THEME_CHOICE).toEqual({ preset: "suite", mode: "system" });
  });

  it("maps a stored logseq selection to Warm", () => {
    const source = memory({
      "suite-go:shell:theme": JSON.stringify({ preset: "logseq", mode: "dark" }),
    });
    expect(readThemeChoice(source)).toEqual({ preset: "warm", mode: "dark" });
  });

  it("answers the default for a record it cannot read", () => {
    expect(readThemeChoice(memory({ "suite-go:shell:theme": "not json" }))).toEqual(
      DEFAULT_GO_THEME_CHOICE,
    );
  });

  it("accepts a pair and refuses a bare mode", () => {
    expect(isGoThemeChoice({ preset: "suite", mode: "system" })).toBe(true);
    expect(isGoThemeChoice({ preset: "suite", mode: "sepia" })).toBe(false);
    expect(isGoThemeChoice("dark")).toBe(false);
    expect(isThemeSource("light")).toBe(true);
  });

  it("falls back for a preset this build does not ship", () => {
    expect(presetFor("solarized")).toBe("solarized");
    expect(presetFor("logseq")).toBe("warm");
    expect(presetFor("neon")).toBe("suite");
    expect(presetFor(null)).toBe("suite");
  });
});

describe("resolving tokens", () => {
  it("follows the phone for system and obeys an explicit choice", () => {
    expect(resolveMode({ preset: "suite", mode: "system" }, true)).toBe("dark");
    expect(resolveMode({ preset: "suite", mode: "system" }, false)).toBe("light");
    expect(resolveMode({ preset: "suite", mode: "light" }, true)).toBe("light");
    expect(resolveMode({ preset: "suite", mode: "dark" }, false)).toBe("dark");
  });

  it("gives a mounted pack the chosen preset's variables", () => {
    const tokens = tokensFor({ preset: "logseq", mode: "dark" }, true, "cozy");
    expect(tokens.scheme).toBe("dark");
    expect(tokens.density).toBe("cozy");
    expect(tokens.cssVariables["--ink"]).toBeTruthy();
  });
});
