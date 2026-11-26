import type { SuiteGoModule } from "@suite/go";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CatalogueEntry } from "../host/catalogue.js";
import { Home } from "./Home.js";

function module(overrides: Partial<SuiteGoModule> = {}): SuiteGoModule {
  return {
    id: "planner",
    name: "Planner",
    icon: "box",
    capabilities: ["documents"],
    accepts: [],
    register: () => ({
      view: () => null,
      dispose: () => undefined,
    }),
    ...overrides,
  };
}

function shadow(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id: "canvas",
    name: "Canvas",
    order: 0,
    description: "Boards and cards",
    version: "1.0.0",
    capabilities: ["documents"],
    platform: { state: "available", reason: "" },
    sizeBytes: 1200,
    sha256: "a".repeat(64),
    url: "https://flatpak.suite.run/packs/canvas.suitepack",
    publisher: "suite",
    installedVersion: null,
    action: "install",
    ...overrides,
  };
}

const common = {
  pinned: [],
  recents: [],
  onOpen: vi.fn(),
  onCapture: vi.fn(),
  onTogglePin: vi.fn(),
  onCatalogue: vi.fn(),
  onInstall: vi.fn(),
  onInstallEntry: vi.fn(),
  onSettings: vi.fn(),
  onRemove: vi.fn(),
  removable: new Set<string>(),
  notice: null,
} as const;

describe("Home's surfaces", () => {
  it("shows the suite mark, the shadow shelf in index order and the installed section", () => {
    const html = renderToString(
      <Home
        {...common}
        modules={[module()]}
        shelf={[
          shadow({ id: "canvas", name: "Canvas", order: 0 }),
          shadow({ id: "budget", name: "Budget", order: 1 }),
        ]}
      />,
    );

    expect(html).toContain("suite-icon.png");
    expect(html).toContain("Suite apps");
    expect(html).toContain("Canvas");
    expect(html).toContain("Budget");
    expect(html.indexOf("Canvas")).toBeLessThan(html.indexOf("Budget"));
    expect(html).toContain("Installed apps");
    expect(html).toContain("Planner");
    expect(html).toContain("Install");
  });

  it("says when the catalogue has no shadow rather than leaving a blank section", () => {
    const html = renderToString(<Home {...common} modules={[]} shelf={[]} />);

    expect(html).toContain("No shadow to show");
  });
});
