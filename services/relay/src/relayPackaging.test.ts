import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseServeOptions } from "./cli.js";

/**
 * The packaging has to keep up with the command line.
 *
 * A relay nobody can start is worse than no relay: `suite-dev` once launched `serve` with a flag this
 * CLI does not have and without the one it requires, so the dev sync server exited immediately and
 * the failure surfaced as a health-probe timeout. These tests read the files a person copies from —
 * the units, the env examples, the how-to — and run their flags through the same parser the binary
 * uses.
 *
 * The how-to names two launch commands and they are the same CLI: `suite-sync serve` on a host, and
 * `flatpak run --command=suite-sync run.suite.sync serve` inside the Flatpak.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

/** The prefixes a documented `serve` line may carry. */
const SERVE_LINE = /^(?:flatpak run --command=suite-sync run\.suite\.sync |suite-sync )serve\b/u;

/** A line with its optional `#` comment marker removed. */
function withoutComment(line: string): string {
  return line.replace(/^#\s*/u, "").trim();
}

describe("relay packaging", () => {
  it("keeps electron-builder's output out of the package it copies", () => {
    // @suite/sync-server's package root is `services/relay`, and the app depends on it, so an output
    // inside that tree is packaged back into the app as a second Electron. The script checks the
    // built tree; this checks the decision that makes it true, before a package is built.
    const config = read("app/electron-builder.yml");
    const output = /^directories:\n(?:.*\n)*? {2}output: (\S+)$/mu.exec(config)?.[1];
    expect(output).toBeDefined();
    expect(relative(ROOT, resolve(ROOT, "app", output ?? "")).startsWith("..")).toBe(true);
    expect(config).toContain(
      "!node_modules/@suite/sync-server/{app,docs,deploy,packages,scripts,src}/**",
    );

    const appPackage = JSON.parse(read("app/package.json")) as { scripts?: Record<string, string> };
    expect(appPackage.scripts?.["package:dir"]).toContain("node scripts/check-package.mjs");
  });

  it("every `serve` line in the how-to is a command this CLI accepts", () => {
    // The page wraps long commands with a trailing backslash. Join those lines
    // before splitting flags, or the parser sees the backslash as an argument.
    const lines = read("docs/how-to/relay.md")
      .split("\n")
      .map((line) => withoutComment(line.trim()));
    const commands: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const first = lines[index];
      if (first === undefined || !SERVE_LINE.test(first)) continue;
      let command = first;
      while (command.endsWith("\\")) {
        index += 1;
        command = `${command.slice(0, -1).trim()} ${lines[index] ?? ""}`.trim();
      }
      commands.push(command);
    }

    expect(commands.length).toBeGreaterThan(0);
    for (const line of commands) {
      const args = line.replace(SERVE_LINE, "").split(/\s+/u).filter(Boolean);
      const parsed = parseServeOptions(args);
      expect(parsed, line).toMatchObject({ ok: true });
    }
  });

  it("the Flatpak unit runs the headless command with the store inside its own sandbox", () => {
    const unit = read("deploy/suite-sync-flatpak.service");
    expect(unit).toContain(
      "ExecStart=/usr/bin/flatpak run --command=suite-sync run.suite.sync serve ",
    );
    // A user unit, because the app is a user Flatpak and its data directory is the writable path.
    expect(unit).toContain("WantedBy=default.target");

    const line = unit
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("ExecStart="));
    expect(line).toBeDefined();
    const args = (line ?? "")
      .replace(/^ExecStart=\S+flatpak run --command=suite-sync run\.suite\.sync serve\s*/u, "")
      .replace("$SUITE_SYNC_ARGS", "")
      .split(/\s+/u)
      .filter(Boolean);
    const parsed = parseServeOptions(args);
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      expect(parsed.value.store).toBe("%h/.var/app/run.suite.sync/data/suite-sync");
      expect(parsed.value.host).toBe("127.0.0.1");
      expect(parsed.value.trustAll).toBe(true);
    }
  });

  it("the env example's live argument line parses and names the state directory", () => {
    const live = read("deploy/relay.env.example")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("SUITE_SYNC_ARGS=") && !line.startsWith("#"));

    expect(live).toHaveLength(1);
    const args = (live[0] ?? "")
      .replace(/^SUITE_SYNC_ARGS=/u, "")
      .split(/\s+/u)
      .filter(Boolean);

    const parsed = parseServeOptions(args);
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      expect(parsed.value.store).toBe(`/var/lib/${stateDirectory()}`);
      // A unit that admits every frame has to be loopback, or the operator has not said otherwise.
      if (!parsed.value.trustAllRemote) expect(parsed.value.host).toBe("127.0.0.1");
    }
  });

  it("the unit starts the binary this repository builds, with the flags from the env file", () => {
    const unit = read("deploy/suite-sync.service");
    expect(unit).toContain("ExecStart=/usr/local/bin/suite-sync serve $SUITE_SYNC_ARGS");
    expect(unit).toContain("EnvironmentFile=-/etc/suite-sync/relay.env");
    expect(unit).toContain(`StateDirectory=${stateDirectory()}`);
  });

  it("gives the service no writable path it does not need", () => {
    const unit = read("deploy/suite-sync.service");
    const directives = unit
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("DynamicUser=yes");
    // Node's JIT needs writable, executable pages; a hardened unit that cannot start protects nothing.
    expect(directives.some((line) => line.startsWith("MemoryDenyWriteExecute"))).toBe(false);
  });
});

function stateDirectory(): string {
  const match = /^StateDirectory=(\S+)$/mu.exec(read("deploy/suite-sync.service"));
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}
