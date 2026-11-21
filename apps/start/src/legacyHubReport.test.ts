import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearLegacyHubReport, legacyHubReportPath } from "./legacyHubReport.js";

/**
 * The report an older Start wrote about a relay it supervised.
 *
 * Canvas reads `hub.json`; a file left behind would keep claiming a relay is
 * running and hand a restore kit an address nothing listens on. Start owns no
 * relay now, so its startup path must leave no claim at all.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "suite-legacy-hub-"));
  cleanups.push(path);
  return path;
}

describe("the legacy hub report", () => {
  it("resolves to the file Canvas reads", async () => {
    const folder = await home();
    expect(legacyHubReportPath({ platform: "linux", home: folder })).toBe(
      join(folder, ".local", "share", "suite", "start", "hub.json"),
    );
  });

  it("is gone after the startup cleanup, so no stale relay claim survives", async () => {
    const folder = await home();
    const path = legacyHubReportPath({ platform: "linux", home: folder });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        format: "suite.hub",
        running: true,
        scope: "network",
        port: 8787,
        address: "ws://192.0.2.10:8787/sync",
        startedAt: "2026-11-20T10:00:00.000Z",
        updatedAt: "2026-11-20T10:00:00.000Z",
      }),
    );

    // The startup call is this one; a second call is the ordinary no-file case.
    expect(await clearLegacyHubReport({ platform: "linux", home: folder })).toBe(true);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await clearLegacyHubReport({ platform: "linux", home: folder })).toBe(true);
  });

  it("uses the host data home a sandbox resolves, not its re-rooted XDG value", async () => {
    const folder = await home();
    expect(
      legacyHubReportPath({
        platform: "linux",
        home: folder,
        xdgDataHome: join(folder, ".local", "share"),
      }),
    ).toBe(join(folder, ".local", "share", "suite", "start", "hub.json"));
  });
});
