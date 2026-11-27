import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { highestCatalogueEntries, highestTrustedUpdate } from "./renderer/catalogueReducer.js";

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(join(here, "renderer", "shell.js"), "utf8");
const reducer = readFileSync(join(here, "renderer", "catalogueReducer.js"), "utf8");
const islandCss = readFileSync(join(here, "renderer", "react", "tab-bar.css"), "utf8");

/**
 * The chrome page cannot run in a Node test, so these checks read it.
 *
 * They are about wiring, not behaviour: the composition's host widget must still be
 * the installed-pack grid with its catalogue and Add pack actions, and the page must
 * stay a read-only view rather than a second copy of the document.
 */
describe("the Home composition", () => {
  it("draws the merged library grid, catalogue and Add pack inside desk.apps", () => {
    const start = shell.indexOf("function renderAppsWidget");
    const end = shell.indexOf("function appWidgetBody");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const apps = shell.slice(start, end);
    expect(apps).toContain("refreshApps");
    expect(apps).toContain('"Packs"');
    expect(apps).not.toContain('"Installed"');
    expect(apps).not.toContain('"Available"');
    expect(apps).toContain('"Add pack…"');
    expect(apps).toContain("api.installPack");

    // The grid it fills has the installed-pack cards and the catalogue entries.
    expect(shell).toContain("fragment.append(installedCard(pack))");
    expect(shell).toContain("fragment.append(catalogueCard(entry))");
  });

  it("moves publisher and key behind a disclosure outside the card body", () => {
    const installedStart = shell.indexOf("function installedCard");
    const catalogueStart = shell.indexOf("function catalogueCard");
    const refreshStart = shell.indexOf("function refreshApps");

    const installed = shell.slice(installedStart, catalogueStart);
    const catalogue = shell.slice(catalogueStart, refreshStart);

    // The disclosure exists with a details element and a summary
    expect(shell).toContain('element("details"');
    expect(shell).toContain('element("summary"');

    // No card body contains Publisher or key text directly
    expect(installed).not.toMatch(/card\.append\([^)]*Publisher/);
    expect(installed).not.toMatch(/card\.append\([^)]*key/);
    expect(catalogue).not.toMatch(/card\.append\([^)]*Publisher/);
    expect(catalogue).not.toMatch(/card\.append\([^)]*key/);

    // Both functions append the disclosure to the tile outside the card body
    expect(installed).toContain("tile.append(disclosure)");
    expect(catalogue).toContain("tile.append(disclosure)");
  });

  it("labels refused actions with actual reasons in words and keeps raw codes in disclosure", () => {
    expect(shell).toContain('"Publisher not trusted"');
    expect(shell).toContain('"Needs a newer Suite Desk"');
    expect(shell).toContain('"Not available on this host"');
    expect(shell).toContain('element("p", "card-code"');
  });

  it("deduplicates catalogue entries for installed pack ids and counts unique ids", () => {
    const refreshStart = shell.indexOf("function refreshApps");
    const refreshEnd = shell.indexOf("function renderAppsWidget");
    expect(refreshStart).toBeGreaterThan(-1);
    expect(refreshEnd).toBeGreaterThan(refreshStart);

    const refresh = shell.slice(refreshStart, refreshEnd);

    // Installed packs win and catalogue entries reduce via compareVersions
    expect(refresh).toContain("installedIds");
    expect(refresh).toContain("highestCatalogueEntries(state.catalogue, installedIds)");
    expect(reducer).toContain("compareVersions(entry.version, kept.version) > 0");

    // packCount counts unique ids rather than array sums
    expect(refresh).not.toContain("state.packs.length + state.catalogue.length");
    expect(refresh).toContain("allIds.size");
  });

  it("offers an update action on the installed card when catalogue has a newer version", () => {
    const installedStart = shell.indexOf("function installedCard");
    const formatBytesStart = shell.indexOf("function formatBytes");
    expect(installedStart).toBeGreaterThan(-1);

    const installed = shell.slice(installedStart, formatBytesStart);

    // Looks up highest trusted newer version via highestTrustedUpdate
    expect(installed).toContain("highestTrustedUpdate(state.catalogue, pack)");
    expect(installed).toContain("updateEntry");
    expect(installed).toContain("Update to v");
    expect(installed).toContain("api.installCataloguePack");
    expect(installed).toContain("pill pill-update");
    expect(reducer).toContain("compareVersions(best.version, pack.version) > 0");
  });

  it("reduces catalogue entries by id to the highest version and skips installed ids", () => {
    const entries = [
      { id: "canvas", version: "0.9.0" },
      { id: "planner", version: "0.10.0" },
      { id: "planner", version: "0.2.0" },
      { id: "planner", version: "0.9.0" },
      { id: "budget", version: "0.2.0" },
      { id: "budget", version: "0.10.0" },
    ];
    const reduced = highestCatalogueEntries(entries, new Set(["canvas"]));
    expect(reduced).toEqual([
      { id: "planner", version: "0.10.0" },
      { id: "budget", version: "0.10.0" },
    ]);
  });

  it("picks the highest trusted update strictly newer than the installed version", () => {
    const catalogue = [
      { id: "canvas", version: "0.11.0", trusted: false },
      { id: "canvas", version: "0.2.0", trusted: true },
      { id: "canvas", version: "0.10.0", trusted: true },
      { id: "canvas", version: "0.9.0", trusted: true },
    ];
    expect(highestTrustedUpdate(catalogue, { id: "canvas", version: "0.9.0" })).toEqual({
      id: "canvas",
      version: "0.10.0",
      trusted: true,
    });
    expect(highestTrustedUpdate(catalogue, { id: "canvas", version: "0.10.0" })).toBeUndefined();
    expect(highestTrustedUpdate(catalogue, { id: "planner", version: "0.1.0" })).toBeUndefined();
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

describe("the chrome's keyboard", () => {
  it("opens a new Home tab on Mod+T, which used to throw", () => {
    // `openHome` is the `#open-home` element, not a function, so the shortcut raised
    // `ReferenceError: openHome is not defined` and did nothing. It has to call the
    // handler the launcher button uses.
    const handler = shell.slice(shell.indexOf('event.key.toLowerCase() === "t"'));
    expect(handler.slice(0, 220)).toContain("openHomeTab()");
    expect(handler.slice(0, 220)).not.toMatch(/openHome\(\)/);
  });

  it("gives focus back after a widget edit rebuilds the tree", () => {
    // `renderWidgets` replaces every tile, so the focused element was destroyed and the
    // next keypress went to the body. The renderer records the focused tile's registry id
    // and restores it.
    const render = shell.slice(
      shell.indexOf("function renderWidgets"),
      shell.indexOf("function renderChoices"),
    );
    expect(render).toContain("focusedRegistryId");
    expect(render).toContain("restored?.focus()");
  });
});

describe("the chrome's height", () => {
  it("reports the measured bar height instead of assuming 44px", () => {
    // The bar is one row on a Screen and two when a pack published material, and both
    // rows follow density, so the main process has to be told what the bar really is.
    const report = shell.slice(
      shell.indexOf("function reportChromeHeight"),
      shell.indexOf("function updateHostBar"),
    );
    expect(report).toContain("getBoundingClientRect().height");
    expect(report).toContain("api.chromeHeight(height)");
    expect(shell).toContain("new ResizeObserver(reportChromeHeight)");
  });

  it("does not send the same height twice", () => {
    const report = shell.slice(
      shell.indexOf("function reportChromeHeight"),
      shell.indexOf("function updateHostBar"),
    );
    expect(report).toContain("height === reportedChromeHeight");
  });
});
