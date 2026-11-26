import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(join(here, "renderer", "shell.js"), "utf8");
const islandCss = readFileSync(join(here, "renderer", "react", "tab-bar.css"), "utf8");

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

  it("draws Settings over the same catalogue and calls the host's theme and Home actions", () => {
    expect(shell).toContain("function renderSettings");
    expect(shell).toContain("renderAppsWidget(elements.settingsApps)");
    expect(shell).toContain("api.setTheme");
    expect(shell).toContain("api.setHomeScreen");
    expect(shell).toContain('settingsSection = "appearance"');
    expect(shell).not.toContain("localStorage");
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

  it("draws the Command Surface and calls the host actions it names", () => {
    expect(shell).toContain("function renderCommandSurface");
    expect(shell).toContain("function invokeSelectedCommand");
    expect(shell).toContain("function refreshCommandSurface");
    expect(shell).not.toContain("command-recents.json");
    for (const action of [
      "commandList",
      "commandInvoke",
      "commandItems",
      "commandCapture",
      "commandOpen",
      "commandSearch",
      "commandOpenLink",
      "commandClearRecents",
    ]) {
      expect(shell).toContain(`api.${action}`);
    }
  });

  it("keeps document state out of the renderer", () => {
    expect(shell).not.toContain("localStorage");
    expect(shell).not.toContain("sessionStorage");
    expect(shell).not.toContain("indexedDB");
  });
});

describe("the tab strip island", () => {
  it("resets the browser's control defaults below the utilities", () => {
    // The island deliberately skips Tailwind's preflight, which is unlayered here and would
    // also reset the legacy chrome. Without this reset a tab button draws with the UA bevel
    // (`border: 2px outset`) and the brand lockup is underlined, which is how the bar looked
    // outside Storybook. Notes the layer order too: `base` must sit under `utilities` so a
    // component's own `border`/`bg-*`/`px-*` still win.
    expect(islandCss).toContain("@layer theme, base, components, legacy, utilities;");
    expect(islandCss).not.toContain('@import "tailwindcss/preflight.css"');

    const base = islandCss.slice(islandCss.indexOf("@layer base {"));
    expect(base).toContain("button, input, select, textarea");
    expect(base).toMatch(/border:\s*0;/);
    expect(base).toMatch(/text-decoration:\s*none;/);
  });
});
