import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sibling } from "./paths.mjs";
import { syncServeArgs } from "./run.mjs";

/**
 * What the dev relay is started with.
 *
 * A flag this CLI does not accept used to make the relay exit on start, and the only symptom was a
 * fifteen-second health-probe timeout followed by "did not answer". These tests read the flags the
 * CLI actually parses, so a wrong one fails here instead of as a timeout.
 */

const CLI_SOURCE = join(sibling("suite-sync"), "apps/server/src/cli.ts");
const hasCli = existsSync(CLI_SOURCE);

describe("dev relay arguments", () => {
  const env = { syncPort: 8787 };
  const args = syncServeArgs(env);

  it("serves, on the port it was given", () => {
    expect(args[0]).toBe("serve");
    expect(args[args.indexOf("--port") + 1]).toBe("8787");
  });

  it("keeps its frames in the relay store, not the seeded workspace", () => {
    const store = args[args.indexOf("--store") + 1] ?? "";
    expect(store).toMatch(/\.dev\/sync$/u);
    expect(store).not.toMatch(/workspace/u);
  });

  it("binds loopback, where admitting any device is a statement about this machine only", () => {
    expect(args[args.indexOf("--host") + 1]).toBe("127.0.0.1");
    expect(args).not.toContain("--trust-all-remote");
  });
});

describe.skipIf(!hasCli)("dev relay arguments match the CLI", () => {
  const accepted = new Set(
    [...readFileSync(CLI_SOURCE, "utf8").matchAll(/case "(--[a-z-]+)":/gu)].map(
      (match) => match[1],
    ),
  );

  it("reads at least one flag, so an empty match is not read as agreement", () => {
    expect(accepted.size).toBeGreaterThan(0);
  });

  it("passes only flags the CLI parses", () => {
    const flags = syncServeArgs({ syncPort: 8787 }).filter((arg) => arg.startsWith("--"));
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) expect(accepted.has(flag), flag).toBe(true);
  });

  it("passes --trust-all, because a serve without it refuses to start", () => {
    expect(syncServeArgs({ syncPort: 8787 })).toContain("--trust-all");
  });
});
