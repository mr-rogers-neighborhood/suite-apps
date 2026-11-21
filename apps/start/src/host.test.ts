import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flatpakSpawnArgs, hostFor, isSandboxed, sandboxId, toolRunner } from "./host.js";

/**
 * The seam's argv, without a real Flatpak.
 *
 * A sandboxed host is a `flatpak-spawn` prefix and one `--env=` element per
 * variable. That is the whole difference, and it is checked here rather than in a
 * rehearsal: a machine without Flatpak still proves the command a sandbox builds.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "suite-host-"));
  cleanups.push(path);
  return path;
}

describe("sandbox detection", () => {
  it("reads the id Flatpak sets and nothing else", () => {
    expect(sandboxId({ FLATPAK_ID: "run.suite.start" })).toBe("run.suite.start");
    expect(sandboxId({ FLATPAK_ID: "  " })).toBeNull();
    expect(sandboxId({})).toBeNull();
    expect(isSandboxed({ FLATPAK_ID: "run.suite.start" })).toBe(true);
    expect(isSandboxed({})).toBe(false);
  });
});

describe("flatpakSpawnArgs", () => {
  it("keeps every value one argv element, so nothing is ever a shell word", () => {
    expect(flatpakSpawnArgs("suite-canvas", ["a b", "c;d", "$(x)"])).toEqual([
      "--host",
      "suite-canvas",
      "a b",
      "c;d",
      "$(x)",
    ]);
  });

  it("puts each variable in front of the command as its own --env= element", () => {
    expect(flatpakSpawnArgs("/opt/app", ["--open"], { B: "2", A: "1" })).toEqual([
      "--host",
      "--env=B=2",
      "--env=A=1",
      "/opt/app",
      "--open",
    ]);
  });
});

describe("the direct host", () => {
  it("plans the command unchanged", () => {
    const host = hostFor(false);
    expect(host.plan({ file: "/opt/suite/canvas", args: ["suite://canvas/x"] })).toEqual({
      file: "/opt/suite/canvas",
      args: ["suite://canvas/x"],
    });
    expect(host.sandboxed).toBe(false);
  });
});

describe("the sandboxed host", () => {
  it("prefixes the command with --host and carries environment as arguments", () => {
    const host = hostFor(true);
    expect(
      host.plan({
        file: "/home/me/Applications/Suite/Canvas/0.1.0/suite-canvas.AppImage",
        args: ["suite://canvas/card/1"],
        env: { SUITE_MANAGED_BY: "start" },
      }),
    ).toEqual({
      file: "flatpak-spawn",
      args: [
        "--host",
        "--env=SUITE_MANAGED_BY=start",
        "/home/me/Applications/Suite/Canvas/0.1.0/suite-canvas.AppImage",
        "suite://canvas/card/1",
      ],
    });
    expect(host.sandboxed).toBe(true);
  });

  it("runs exactly that argv, and finds a host command once", async () => {
    const directory = await folder();
    const log = join(directory, "spawn.log");
    await writeFile(
      join(directory, "flatpak-spawn"),
      `#!/bin/sh\nprintf '%s\\n' "$@" >>"${log}"\n`,
      { mode: 0o755 },
    );

    const previous = process.env.PATH;
    process.env.PATH = `${directory}${delimiter}${previous ?? ""}`;
    try {
      const host = hostFor(true);
      await host.run({ file: "flatpak", args: ["--version"], env: { A: "1" } });

      const first = (await readFile(log, "utf8")).trim().split("\n");
      expect(first).toEqual(["--host", "--env=A=1", "flatpak", "--version"]);

      // The probe is memoised: two questions, one process.
      expect(await host.which("flatpak")).toBe("flatpak");
      expect(await host.which("flatpak")).toBe("flatpak");
      const versions = (await readFile(log, "utf8"))
        .split("\n")
        .filter((line) => line === "--version");
      expect(versions).toHaveLength(2);
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
    }
  });
});

describe("which", () => {
  it("memoises the direct PATH search", async () => {
    const directory = await folder();
    const binary = join(directory, "flatpak");
    await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const previous = process.env.PATH;
    process.env.PATH = `${directory}${delimiter}${previous ?? ""}`;
    try {
      const host = hostFor(false);
      expect(await host.which("flatpak")).toBe(binary);
      await rm(binary);
      // The answer cannot change while Start runs, so the cache is the answer.
      expect(await host.which("flatpak")).toBe(binary);
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
    }
  });
});

describe("toolRunner", () => {
  it("ignores a missing cache tool and says so once", async () => {
    const warnings: string[] = [];
    const run = toolRunner(hostFor(false), (message) => warnings.push(message));
    await run("suite-no-such-cache-tool", ["--update"]);
    await run("suite-no-such-cache-tool", ["--update"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("suite-no-such-cache-tool");
  });
});
