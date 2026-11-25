import { describe, expect, it } from "vitest";

import type { Paintable } from "./apply.js";
import {
  applyScale,
  DEFAULT_DENSITY,
  DENSITIES,
  DENSITY_SCALE,
  densityVariables,
  DURATIONS,
  DURATION_SCALE,
  EASE_STANDARD,
  motionVariables,
  RADIUS_ROLES,
  RADIUS_SCALE,
  radiusVariables,
  scaleVariables,
  SHADOW_ROLES,
  SHADOW_SCALE,
  shadowVariables,
  TYPE_ROLES,
  TYPE_SCALE,
  typeVariables,
} from "./scale.js";

const px = (value: string): number => Number.parseInt(value, 10);

describe("the type scale", () => {
  it("keeps every size that shipped, so adopting it moves no pixel", () => {
    // These are the five values the primitives actually used. A scale that "tidied" them would
    // be a redesign smuggled in with a rename.
    expect(TYPE_ROLES.map((role) => TYPE_SCALE[role].size)).toEqual([
      "11px",
      "12px",
      "13px",
      "15px",
      "34px",
    ]);
  });

  it("never goes below a legible body size", () => {
    expect(px(TYPE_SCALE.body.size)).toBeGreaterThanOrEqual(13);
  });

  it("is ordered, so the names mean something", () => {
    const sizes = TYPE_ROLES.map((role) => px(TYPE_SCALE[role].size));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it("has a line height that clears its size", () => {
    for (const role of TYPE_ROLES) {
      expect(px(TYPE_SCALE[role].lineHeight)).toBeGreaterThan(px(TYPE_SCALE[role].size));
    }
  });
});

describe("density", () => {
  it("uses the names the mobile contract already publishes", () => {
    // `@suite/go` has ThemeDensity = compact | cozy | comfortable. A fourth name would be a
    // fork with extra steps.
    expect([...DENSITIES]).toEqual(["compact", "cozy", "comfortable"]);
  });

  it("keeps cozy as what the desktop shipped", () => {
    expect(DEFAULT_DENSITY).toBe("cozy");
    // Button md was h-9 (36px) with px-3 (12px); sm was h-8 (32px) with px-2.5 (10px).
    expect(DENSITY_SCALE.cozy.controlHeight).toBe("36px");
    expect(DENSITY_SCALE.cozy.controlHeightSmall).toBe("32px");
    expect(DENSITY_SCALE.cozy.controlPaddingX).toBe("12px");
    expect(DENSITY_SCALE.cozy.controlPaddingXSmall).toBe("10px");
  });

  it("reaches the touch floor at comfortable", () => {
    // SC 2.5.5 asks 44px. This is why the density axis exists.
    expect(px(DENSITY_SCALE.comfortable.controlHeight)).toBeGreaterThanOrEqual(44);
    expect(px(DENSITY_SCALE.comfortable.controlHeightSmall)).toBeGreaterThanOrEqual(40);
  });

  it("increases monotonically, so no step is a surprise", () => {
    const heights = DENSITIES.map((density) => px(DENSITY_SCALE[density].controlHeight));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });

  it("does not touch type, so it cannot multiply with the system font scale", () => {
    // Density publishes space only. If it ever published a font size, a phone at 1.3 font scale
    // and comfortable density would compound, and nothing has measured that layout.
    const names = Object.keys(densityVariables("comfortable"));
    expect(names.some((name) => name.includes("text") || name.includes("leading"))).toBe(false);
  });

  it("publishes every type step as a size and a line height", () => {
    const names = Object.keys(typeVariables());
    for (const role of TYPE_ROLES) {
      expect(names).toContain(`--text-${role}`);
      expect(names).toContain(`--leading-${role}`);
    }
    expect(names).toHaveLength(TYPE_ROLES.length * 2);
  });
});

describe("the radius scale", () => {
  it("keeps Tailwind's four steps, so adopting it moves no corner", () => {
    // Tailwind 4.3.5 publishes --radius-sm: .25rem, md: .375rem, lg: .5rem, xl: .75rem, and
    // `rounded-md` compiles to `border-radius: var(--radius-md)`. Publishing those values on
    // :root is what lets a host reach a pack's classes; the same values are what renders today.
    expect(RADIUS_SCALE).toEqual({ sm: "4px", md: "6px", lg: "8px", xl: "12px" });
  });

  it("is ordered, so the names mean something", () => {
    const sizes = RADIUS_ROLES.map((role) => px(RADIUS_SCALE[role]));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it("publishes one custom property per step and no others", () => {
    expect(radiusVariables()).toEqual({
      "--radius-sm": "4px",
      "--radius-md": "6px",
      "--radius-lg": "8px",
      "--radius-xl": "12px",
    });
  });
});

describe("the elevation scale", () => {
  it("keeps the two steps the tree draws with, at Tailwind's values", () => {
    // Budget's menus are `shadow-xl` (8 sites) and its dialog `shadow-2xl` (1). These strings are
    // Tailwind's defaults verbatim, so a host that publishes them repaints nothing.
    expect([...SHADOW_ROLES]).toEqual(["xl", "2xl"]);
    expect(SHADOW_SCALE.xl).toBe(
      "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    );
    expect(SHADOW_SCALE["2xl"]).toBe("0 25px 50px -12px rgb(0 0 0 / 0.25)");
  });

  it("publishes one custom property per step", () => {
    expect(shadowVariables()).toEqual({
      "--shadow-xl": SHADOW_SCALE.xl,
      "--shadow-2xl": SHADOW_SCALE["2xl"],
    });
  });
});

describe("the motion scale", () => {
  it("keeps the base duration a transition already runs at", () => {
    // `transition-colors` uses Tailwind's --default-transition-duration, which is 150ms. A base
    // that did not match it would slow or speed every hover in every app.
    expect(DURATION_SCALE.base).toBe("150ms");
  });

  it("orders the durations", () => {
    const steps = DURATIONS.map((duration) => px(DURATION_SCALE[duration]));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("keeps the curve Tailwind's default timing function", () => {
    expect(EASE_STANDARD).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
  });

  it("publishes the three durations and the one curve", () => {
    expect(motionVariables()).toEqual({
      "--duration-fast": "100ms",
      "--duration-base": "150ms",
      "--duration-slow": "240ms",
      "--ease-standard": EASE_STANDARD,
    });
  });
});

describe("scaleVariables", () => {
  it("publishes every layer, and nothing twice", () => {
    const values = scaleVariables(DEFAULT_DENSITY);
    const names = Object.keys(values);
    const layers = [
      typeVariables(),
      densityVariables(DEFAULT_DENSITY),
      radiusVariables(),
      shadowVariables(),
      motionVariables(),
    ];
    const total = layers.reduce((count, layer) => count + Object.keys(layer).length, 0);
    expect(names).toHaveLength(total);
    for (const layer of layers) {
      for (const [name, value] of Object.entries(layer)) expect(values[name]).toBe(value);
    }
  });

  it("names every property as a custom property", () => {
    for (const name of Object.keys(scaleVariables("comfortable"))) {
      expect(name.startsWith("--")).toBe(true);
    }
  });

  it("carries the density it was asked for", () => {
    expect(scaleVariables("compact")["--control-height"]).toBe("32px");
    expect(scaleVariables("cozy")["--control-height"]).toBe("36px");
    expect(scaleVariables("comfortable")["--control-height"]).toBe("44px");
  });
});

describe("applyScale", () => {
  it("sets every scale variable on the target and records the density", () => {
    const written: Record<string, string> = {};
    const target: Paintable & { dataset: Record<string, string | undefined> } = {
      style: {
        setProperty(name: string, value: string): void {
          written[name] = value;
        },
      },
      dataset: {},
    };

    applyScale("cozy", target);

    expect(written).toEqual(scaleVariables("cozy"));
    expect(target.dataset.density).toBe("cozy");
  });
});
