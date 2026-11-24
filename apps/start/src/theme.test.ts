import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme.js";

describe("the hub's theme", () => {
  it("paints the default Suite preset in both desktop modes", () => {
    expect(resolveTheme(false).mode).toBe("light");
    expect(resolveTheme(true).mode).toBe("dark");
    expect(resolveTheme(true).preset).toBe("suite");
    expect(resolveTheme(false).preset).toBe("suite");
  });

  it("carries every role as a custom property", () => {
    const theme = resolveTheme(true);
    expect(theme.values["--canvas"]).toBeTruthy();
    expect(theme.values["--ink"]).toBeTruthy();
  });

  it("offers no preset list, because Start is not the host", () => {
    // The host's View menu owns the picker; a second list here would be a second identity.
    expect(resolveTheme(false)).not.toHaveProperty("options");
    expect(resolveTheme(false)).not.toHaveProperty("choice");
  });
});
