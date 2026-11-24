import { REQUIRED_ROLES } from "@suite/theme";
import { afterEach, describe, expect, it, vi } from "vitest";
import styles from "./styles.css?raw";
import { resolvedTheme } from "./theme";

/** Every `:root` block's declarations, in source order. */
function rootBlocks(): string[] {
  return [...styles.matchAll(/:root[^{}]*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme-mode");
  vi.unstubAllGlobals();
});

describe("the standalone palette", () => {
  it("defines every role in the light fallback", () => {
    const [light] = rootBlocks();
    expect(light).toBeDefined();
    for (const role of REQUIRED_ROLES) {
      expect(light, `--${role} is undefined in :root`).toContain(`--${role}:`);
    }
  });

  it("defines every role again for a dark desktop", () => {
    // A host overwrites these with its own values; without a second block a standalone
    // Help on a dark desktop has a dark window frame and undefined tokens.
    const blocks = rootBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const role of REQUIRED_ROLES) {
      expect(blocks[1], `--${role} is undefined in the dark :root`).toContain(`--${role}:`);
    }
    expect(styles).toContain("@media (prefers-color-scheme: dark)");
  });
});

describe("resolvedTheme", () => {
  it("reads the mode the host painted", () => {
    document.documentElement.dataset.themeMode = "dark";
    expect(resolvedTheme()).toBe("dark");
    document.documentElement.dataset.themeMode = "light";
    expect(resolvedTheme()).toBe("light");
  });

  it("follows the desktop when no host has painted", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(resolvedTheme()).toBe("dark");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(resolvedTheme()).toBe("light");
  });
});
