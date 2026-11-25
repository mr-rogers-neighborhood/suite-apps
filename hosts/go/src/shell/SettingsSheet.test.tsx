import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsSheet } from "./SettingsSheet.js";

describe("SettingsSheet", () => {
  it("renders nothing when closed", () => {
    expect(
      renderToString(
        <SettingsSheet
          open={false}
          choice={{ preset: "suite", mode: "system" }}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    ).toBe("");
  });

  it("offers brightness and the presets in the host's order", () => {
    const html = renderToString(
      <SettingsSheet
        open
        choice={{ preset: "suite", mode: "system" }}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Brightness"');
    expect(html).toContain('aria-label="Theme"');
    expect(html).toContain(">Light</option>");
    expect(html).toContain(">Dark</option>");
    expect(html).toContain(">Follow the system</option>");

    const suite = html.indexOf(">Suite</option>");
    const warm = html.indexOf(">Warm</option>");
    const solarized = html.indexOf(">Solarized</option>");
    expect(suite).toBeGreaterThan(-1);
    expect(warm).toBeGreaterThan(suite);
    expect(solarized).toBeGreaterThan(warm);
  });

  it("shows the chosen preset as the selected value", () => {
    const html = renderToString(
      <SettingsSheet
        open
        choice={{ preset: "warm", mode: "dark" }}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain('<select aria-label="Theme"');
    expect(html).toContain('<option value="warm" selected="">Warm</option>');
  });
});
