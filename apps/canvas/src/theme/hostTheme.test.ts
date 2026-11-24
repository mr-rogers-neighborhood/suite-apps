import { afterEach, describe, expect, it, vi } from "vitest";
import { hostTheme } from "./hostTheme";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-mode");
  vi.unstubAllGlobals();
});

describe("hostTheme", () => {
  it("reads the mode and preset the host painted", () => {
    document.documentElement.dataset.theme = "warm";
    document.documentElement.dataset.themeMode = "dark";
    expect(hostTheme()).toEqual({ mode: "dark", key: "warm:dark" });
  });

  it("changes its key when the host changes only the preset", () => {
    document.documentElement.dataset.theme = "suite";
    document.documentElement.dataset.themeMode = "dark";
    const before = hostTheme().key;
    document.documentElement.dataset.theme = "solarized";
    expect(hostTheme().key).not.toBe(before);
    expect(hostTheme().mode).toBe("dark");
  });

  it("follows prefers-color-scheme when no host has painted", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    expect(hostTheme()).toEqual({ mode: "dark", key: "suite:dark" });
  });
});
