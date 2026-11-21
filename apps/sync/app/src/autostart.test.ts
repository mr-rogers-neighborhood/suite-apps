import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autostartCommand,
  autostartEnabled,
  autostartEntry,
  autostartEntryFor,
  autostartLocation,
  disableAutostart,
  enableAutostart,
  execValue,
} from "./autostart.js";

/**
 * The login entry, as a file and as a decision.
 *
 * The one thing this cannot check without a desktop is whether a session honours it; what it
 * can check is that the entry lands on the path the manifest grants, that it names a command
 * that exists on the host, and that turning it off removes it.
 */

const dirs: string[] = [];

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "suite-sync-autostart-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("where the entry goes", () => {
  it("uses the host's config directory inside the Flatpak, not the private one", async () => {
    const location = autostartLocation({
      appId: "run.suite.sync",
      home: await home(),
      env: { FLATPAK_ID: "run.suite.sync", XDG_CONFIG_HOME: "/home/person/.var/app/x/config" },
    });

    // `--filesystem=xdg-config/autostart:create` keeps this subdirectory where the host keeps
    // it, and the session reads it there. XDG_CONFIG_HOME is the sandbox's own directory.
    expect(location.file).toBe(join(location.dir, "run.suite.sync.desktop"));
    expect(location.file).toContain(`/.config/autostart/`);
    expect(location.file).not.toContain(".var/app");
    expect(location.sandboxed).toBe(true);
  });

  it("follows XDG_CONFIG_HOME when it is not sandboxed", async () => {
    const location = autostartLocation({
      appId: "run.suite.sync",
      home: "/home/person",
      env: { XDG_CONFIG_HOME: "/tmp/config" },
    });
    expect(location.file).toBe("/tmp/config/autostart/run.suite.sync.desktop");
    expect(location.sandboxed).toBe(false);
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
    const location = autostartLocation({
      appId: "run.suite.sync",
      home: "/home/person",
      env: {},
    });
    expect(location.file).toBe("/home/person/.config/autostart/run.suite.sync.desktop");
  });
});

describe("the entry", () => {
  it("is a desktop entry that starts the app without a window", () => {
    const text = autostartEntryFor({
      appId: "run.suite.sync",
      name: "Suite Sync",
      comment: "Your Suite relay, running in the tray",
      env: { FLATPAK_ID: "run.suite.sync" },
      execPath: "/app/sync/suite-sync",
      appRoot: "/app/sync/resources/app.asar",
    });

    expect(text.startsWith("[Desktop Entry]\n")).toBe(true);
    expect(text).toContain("Type=Application");
    expect(text).toContain("Name=Suite Sync");
    expect(text).toContain("Exec=flatpak run run.suite.sync --hidden");
    expect(text).toContain("X-GNOME-Autostart-enabled=true");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("points at the Electron binary when it is not sandboxed", () => {
    const text = autostartEntryFor({
      appId: "run.suite.sync",
      name: "Suite Sync",
      comment: "comment",
      env: {},
      execPath: "/home/person/.local/bin/suite-sync",
      appRoot: "/home/person/src/suite-apps/apps/sync/app",
    });
    expect(text).toContain(`Exec=/home/person/.local/bin/suite-sync /home/person/src`);
    expect(text).toContain("--hidden");
  });

  it("quotes the arguments a session would otherwise split", () => {
    expect(execValue(["flatpak", "run", "run.suite.sync", "--hidden"])).toBe(
      "flatpak run run.suite.sync --hidden",
    );
    expect(execValue(["/home/a person/app", "--hidden"])).toBe('"/home/a person/app" --hidden');
    expect(autostartEntry({ name: "n", comment: "c", exec: "x" })).toContain("Exec=x");
  });
});

describe("turning it on and off", () => {
  it("writes the file, reports it, and removes it again", async () => {
    const base = await home();
    const location = autostartLocation({
      appId: "run.suite.sync",
      home: base,
      env: {},
    });
    expect(autostartEnabled(location)).toBe(false);

    const written = enableAutostart(location, "entry");
    expect(written).toBe(join(base, ".config", "autostart", "run.suite.sync.desktop"));
    expect(autostartEnabled(location)).toBe(true);
    expect(await readFile(written, "utf8")).toBe("entry");

    expect(disableAutostart(location)).toBe(true);
    expect(autostartEnabled(location)).toBe(false);
    // Removing a file that is already gone is the state that was asked for, not a failure.
    expect(disableAutostart(location)).toBe(false);
  });
});

describe("the autostart command", () => {
  function run(base: string, argv: readonly string[]) {
    return autostartCommand({
      argv,
      location: autostartLocation({ appId: "run.suite.sync", home: base, env: {} }),
      entry: () => autostartEntry({ name: "Suite Sync", comment: "c", exec: "flatpak run x" }),
    });
  }

  it("is off until it is on", async () => {
    const status = run(await home(), ["status"]);
    expect(status.code).toBe(0);
    expect(status.stdout.startsWith("off\n")).toBe(true);
  });

  it("writes the same file the window's checkbox writes", async () => {
    const base = await home();
    const written = run(base, ["on"]);
    expect(written.code).toBe(0);
    expect(written.stdout).toContain("run.suite.sync.desktop");

    const status = run(base, ["status"]);
    expect(status.stdout.startsWith("on\n")).toBe(true);
  });

  it("removes it and says so", async () => {
    const base = await home();
    run(base, ["on"]);
    const removed = run(base, ["off"]);
    expect(removed.stdout.startsWith("removed ")).toBe(true);
  });

  it("refuses anything else with the usage line", async () => {
    const refused = run(await home(), ["maybe"]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("autostart <on|off|status>");
  });
});
