import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseServeOptions } from "./cli.js";

/**
 * The packaging has to keep up with the command line.
 *
 * A relay nobody can start is worse than no relay: `suite-dev` once launched `serve` with a flag this
 * CLI does not have and without the one it requires, so the dev sync server exited immediately and
 * the failure surfaced as a health-probe timeout. These tests read the files a person copies from —
 * the unit, the env example, the how-to — and run their flags through the same parser the binary uses.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("relay packaging", () => {
  it("every `suite-sync serve` line in the how-to is a command this CLI accepts", () => {
    // The page wraps long commands with a trailing backslash. Join those lines
    // before splitting flags, or the parser sees the backslash as an argument.
    const lines = read("docs/how-to/relay.md")
      .split("\n")
      .map((line) => line.trim());
    const commands: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const first = lines[index];
      if (first === undefined || !first.startsWith("suite-sync serve")) continue;
      let command = first;
      while (command.endsWith("\\")) {
        index += 1;
        command = `${command.slice(0, -1).trim()} ${lines[index] ?? ""}`.trim();
      }
      commands.push(command);
    }

    expect(commands.length).toBeGreaterThan(0);
    for (const line of commands) {
      const args = line
        .replace(/^suite-sync serve\s*/u, "")
        .split(/\s+/u)
        .filter(Boolean);
      const parsed = parseServeOptions(args);
      expect(parsed, line).toMatchObject({ ok: true });
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
