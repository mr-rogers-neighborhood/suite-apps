import { DEFAULT_THEME_ID } from "@suite/theme";
import { afterEach, describe, expect, it } from "vitest";

import {
  readStoredTheme,
  resolvedTheme,
  resolveTheme,
  setThemeChoice,
  THEME_STORAGE_KEY,
} from "./theme";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-mode");
  document.documentElement.removeAttribute("data-mode");
  document.documentElement.removeAttribute("style");
});

describe("resolveTheme", () => {
  it("resolves system against the desktop", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("takes a chosen mode as given, whatever the desktop says", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("readStoredTheme", () => {
  it("follows the desktop with the default preset when nothing is stored", () => {
    expect(readStoredTheme({ getItem: () => null })).toEqual({
      preset: DEFAULT_THEME_ID,
      mode: "system",
    });
    expect(readStoredTheme(undefined)).toEqual({ preset: DEFAULT_THEME_ID, mode: "system" });
  });

  it("reads the pair a choice is stored as", () => {
    const storage = {
      getItem: (key: string) =>
        key === THEME_STORAGE_KEY ? JSON.stringify({ preset: "logseq", mode: "dark" }) : null,
    };
    expect(readStoredTheme(storage)).toEqual({ preset: "logseq", mode: "dark" });
  });

  it("keeps a bare mode written before presets existed", () => {
    expect(readStoredTheme({ getItem: () => "dark" })).toEqual({
      preset: DEFAULT_THEME_ID,
      mode: "dark",
    });
  });
});

describe("setThemeChoice", () => {
  it("paints the mode onto the root and keeps the dark class in step", () => {
    setThemeChoice({ preset: DEFAULT_THEME_ID, mode: "dark" });
    expect(resolvedTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--surface")).not.toBe("");

    setThemeChoice({ preset: DEFAULT_THEME_ID, mode: "light" });
    expect(resolvedTheme()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.mode).toBe("light");
  });
});
