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
          density="cozy"
          onChange={vi.fn()}
          onDensityChange={vi.fn()}
          apps={[]}
          onRemoveApp={vi.fn()}
          onReask={vi.fn()}
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
        density="cozy"
        onChange={vi.fn()}
        onDensityChange={vi.fn()}
        apps={[]}
        onRemoveApp={vi.fn()}
        onReask={vi.fn()}
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
        density="cozy"
        onChange={vi.fn()}
        onDensityChange={vi.fn()}
        apps={[]}
        onRemoveApp={vi.fn()}
        onReask={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain('<select aria-label="Theme"');
    expect(html).toContain('<option value="warm" selected="">Warm</option>');
  });

  it("lists an installed app, its remembered refusal and a deliberate re-ask", () => {
    const html = renderToString(
      <SettingsSheet
        open
        choice={{ preset: "suite", mode: "system" }}
        density="cozy"
        onChange={vi.fn()}
        onDensityChange={vi.fn()}
        apps={[
          {
            id: "planner",
            name: "Planner",
            version: "2.0.0",
            publisher: "suite",
            sizeBytes: 2400,
            installedAt: Date.UTC(2026, 10, 25),
            permissions: [
              {
                capability: "recents",
                tier: "first-use",
                answer: "denied",
                reason: "read the host's recent-files list",
                answeredAt: 1,
              },
            ],
          },
        ]}
        onRemoveApp={vi.fn()}
        onReask={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("Planner");
    expect(html).toContain("v<!-- -->2.0.0");
    expect(html).toContain("by <!-- -->suite");
    expect(html).toContain("2 KB");
    expect(html).toContain("2026-11-25");
    expect(html).toContain("recents<!-- -->: <!-- -->denied");
    expect(html).toContain("Ask again");
    expect(html).toContain("Remove <!-- -->Planner");
  });
});
