import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CatalogueEntry } from "../host/catalogue.js";
import { Catalogue, CatalogueRow, formatBytes } from "./Catalogue.js";

function entry(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id: "probe",
    name: "Probe",
    description: "A small app",
    version: "2.0.0",
    capabilities: ["documents", "notifications"],
    platform: { state: "unknown", reason: "platform unknown — this pack declares no platforms" },
    sizeBytes: 1200,
    sha256: "a".repeat(64),
    url: "https://flatpak.suite.run/packs/probe.suitepack",
    publisher: "suite",
    installedVersion: "1.0.0",
    action: "update",
    ...overrides,
  };
}

describe("the app catalogue", () => {
  it("shows what is available and what is installed, with capabilities", () => {
    const html = renderToString(
      <Catalogue
        entries={[entry()]}
        notice={null}
        loading={false}
        onRefresh={vi.fn()}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("App catalogue");
    expect(html).toContain("Probe");
    expect(html).toContain("probe");
    expect(html).toContain("by <!-- -->suite");
    // React separates an expression from its surrounding text with an SSR comment.
    expect(html).toContain("version <!-- -->2.0.0");
    expect(html).toContain("Uses documents, notifications");
    expect(html).toContain("1 KB");
    expect(html).toContain("Installed 1.0.0; 2.0.0 is available");
    expect(html).toContain("Update");
    expect(html).toContain("Remove");
  });

  it("offers Install for a pack that is not installed and no Remove", () => {
    const html = renderToString(
      <CatalogueRow
        entry={entry({ installedVersion: null, action: "install" })}
        confirming={false}
        onInstall={vi.fn()}
        onAskRemove={vi.fn()}
        onCancelRemove={vi.fn()}
        onConfirmRemove={vi.fn()}
      />,
    );

    expect(html).toContain("Not installed");
    expect(html).toContain("Install");
    expect(html).not.toContain("Remove");
  });

  it("offers Reinstall for the installed version and Installed when it is newer", () => {
    const reinstall = renderToString(
      <CatalogueRow
        entry={entry({ installedVersion: "2.0.0", action: "reinstall" })}
        confirming={false}
        onInstall={vi.fn()}
        onAskRemove={vi.fn()}
        onCancelRemove={vi.fn()}
        onConfirmRemove={vi.fn()}
      />,
    );
    expect(reinstall).toContain("Reinstall");

    const current = renderToString(
      <CatalogueRow
        entry={entry({ installedVersion: "3.0.0", action: "current" })}
        confirming={false}
        onInstall={vi.fn()}
        onAskRemove={vi.fn()}
        onCancelRemove={vi.fn()}
        onConfirmRemove={vi.fn()}
      />,
    );
    expect(current).toContain("Installed 3.0.0");
    expect(current).toContain("Installed</button>");
  });

  it("asks once before removal and says documents stay", () => {
    const html = renderToString(
      <CatalogueRow
        entry={entry()}
        confirming={true}
        onInstall={vi.fn()}
        onAskRemove={vi.fn()}
        onCancelRemove={vi.fn()}
        onConfirmRemove={vi.fn()}
      />,
    );

    expect(html).toContain("Remove <!-- -->Probe<!-- -->? Its documents stay on this device.");
    expect(html).toContain("Cancel");
    expect(html).toContain("Remove</button>");
  });

  it("reports the refusal sentence a failed verification produced", () => {
    const html = renderToString(
      <Catalogue
        entries={[]}
        notice="This catalogue index expired at 2026-05-01T00:00:00.000Z; a stale catalogue is refused."
        loading={false}
        onRefresh={vi.fn()}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("expired");
    expect(html).toContain("Nothing in the catalogue yet");
  });

  it("prints sizes a person can read", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1200)).toBe("1 KB");
    expect(formatBytes(1258291)).toBe("1.2 MB");
  });
});
