import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(join(here, "renderer", "shell.js"), "utf8");

/**
 * The chrome page cannot run in a Node test, so these checks read it.
 *
 * They are about wiring, not behaviour: the composition's host widget must still be
 * the installed-pack grid with its catalogue and Add pack actions, and the page must
 * stay a read-only view rather than a second copy of the document.
 */
describe("the Home composition", () => {
  it("draws the installed pack grid, catalogue and Add pack inside desk.apps", () => {
    const start = shell.indexOf("function renderAppsWidget");
    const end = shell.indexOf("function appWidgetBody");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const apps = shell.slice(start, end);
    expect(apps).toContain("refreshApps");
    expect(apps).toContain('"Installed"');
    expect(apps).toContain('"Available"');
    expect(apps).toContain('"Add pack…"');
    expect(apps).toContain("api.installPack");

    // The grids it fills are the installed-pack cards and the catalogue entries.
    expect(shell).toContain("fragment.append(installedCard(pack))");
    expect(shell).toContain("fragment.append(catalogueCard(entry))");
  });

  it("routes desk.apps to the host widget body", () => {
    expect(shell).toContain('widget.registryId === "desk.apps"');
  });

  it("draws the Screens manager and calls the host actions it names", () => {
    expect(shell).toContain("function renderScreensPanel");
    for (const action of [
      "createScreen",
      "renameScreen",
      "duplicateScreen",
      "deleteScreen",
      "setHomeScreen",
      "openScreen",
      "exportScreen",
      "importScreen",
    ]) {
      expect(shell).toContain(`api.${action}`);
    }
    expect(shell).not.toContain("screens.json");
  });

  it("draws a row in document order and leaves its children outside the edit controls", () => {
    expect(shell).toContain("function rowTile");
    expect(shell).toContain("widget-row-track");
    expect(shell).toContain("--row-weight");
    expect(shell).toContain('entry.kind === "row" ? rowTile(entry)');
  });

  it("draws the relay state the tray app used to own", () => {
    expect(shell).toContain("function renderSync");
    expect(shell).toContain("relay: { ...EMPTY_RELAY }");
    expect(shell).toContain('document.querySelector("#sync-address")');
    expect(shell).toContain('document.querySelector("#sync-fingerprint")');
    expect(shell).toContain('document.querySelector("#sync-code")');
    for (const action of ["relayStart", "relayStop"]) {
      expect(shell).toContain(`api.${action}`);
    }
  });

  it("keeps document state out of the renderer", () => {
    expect(shell).not.toContain("localStorage");
    expect(shell).not.toContain("sessionStorage");
    expect(shell).not.toContain("indexedDB");
  });
});
