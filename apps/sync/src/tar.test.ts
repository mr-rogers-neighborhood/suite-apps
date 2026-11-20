import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tarGz } from "./tar.js";

/**
 * The archive is only useful if the system's own tar can read it, so the test asks the system.
 *
 * GNU tar and bsdtar both implement ustar; a hand-rolled writer that only satisfies its own reader
 * would pass a round-trip test and still fail on a person's machine.
 */

let dir: string | null = null;

function hasTar(): boolean {
  try {
    execFileSync("tar", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("tarGz", () => {
  it("refuses an empty archive rather than writing a file with nothing in it", () => {
    expect(() => tarGz([])).toThrow(/nothing to archive/u);
  });

  it.skipIf(!hasTar())("round-trips through the system tar", () => {
    dir = mkdtempSync(join(tmpdir(), "suite-tar-"));
    const archive = join(dir, "relay.tar.gz");
    writeFileSync(
      archive,
      tarGz([
        { path: "dist/cli.js", bytes: Buffer.from("#!/usr/bin/env node\n", "utf8"), mode: 0o755 },
        { path: "package.json", bytes: Buffer.from('{"name":"relay"}\n', "utf8") },
        // Empty files are where a naive 512-byte pad goes wrong.
        { path: "lib/empty.js", bytes: Buffer.alloc(0) },
        // Exactly one block: no padding is added, and the next header must still line up.
        { path: "lib/block.bin", bytes: Buffer.alloc(512, 7) },
        // Over 100 bytes, so the ustar prefix split is exercised rather than assumed.
        {
          path: `node_modules/@suite/${"nested-".repeat(8)}index.js`,
          bytes: Buffer.from("export {};\n", "utf8"),
        },
        // Over 255 bytes, which ustar cannot hold at all: this must go through @LongLink and still
        // extract to the same place. `node_modules` in a real release hits this without trying.
        {
          path: `node_modules/.pnpm/${"@scope+pkg@1.0.0".repeat(4)}/node_modules/pkg/dist/deep/file.js`,
          bytes: Buffer.from("export const deep = 1;\n", "utf8"),
        },
      ]),
    );

    const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    expect(listing).toHaveLength(6);
    expect(listing).toContain("suite-sync/dist/cli.js");
    expect(
      listing.some(
        (line) => line.endsWith("index.js") && line.startsWith("suite-sync/node_modules/@suite/"),
      ),
    ).toBe(true);

    execFileSync("tar", ["-xzf", archive, "-C", dir]);
    expect(execFileSync("cat", [join(dir, "suite-sync/dist/cli.js")], { encoding: "utf8" })).toBe(
      "#!/usr/bin/env node\n",
    );
    expect(execFileSync("cat", [join(dir, "suite-sync/package.json")], { encoding: "utf8" })).toBe(
      '{"name":"relay"}\n',
    );
    expect(
      execFileSync("wc", ["-c", join(dir, "suite-sync/lib/block.bin")], {
        encoding: "utf8",
      }).trim(),
    ).toMatch(/^512\b/u);

    // The @LongLink entry is only correct if the file lands at the path it named, not at the
    // truncated one its header carried.
    const deeply = join(
      dir,
      "suite-sync",
      `node_modules/.pnpm/${"@scope+pkg@1.0.0".repeat(4)}/node_modules/pkg/dist/deep/file.js`,
    );
    expect(execFileSync("cat", [deeply], { encoding: "utf8" })).toBe("export const deep = 1;\n");
  });

  it.skipIf(!hasTar())("keeps the executable bit the caller asked for", () => {
    dir = mkdtempSync(join(tmpdir(), "suite-tar-mode-"));
    const archive = join(dir, "mode.tar.gz");
    writeFileSync(archive, tarGz([{ path: "bin/relay", bytes: Buffer.from("x"), mode: 0o755 }]));
    execFileSync("tar", ["-xzf", archive, "-C", dir]);
    const mode = execFileSync("stat", ["-c", "%a", join(dir, "suite-sync/bin/relay")], {
      encoding: "utf8",
    }).trim();
    expect(mode).toBe("755");
  });
});
