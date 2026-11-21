import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  adoptChannelWorkspace,
  adoptLegacyWorkspace,
  slopWorkspaceFolder,
  workspaceFromArgv,
  workspaceFromLink,
  workspacePathsFrom,
} from "./workspaceLocation";
import { WorkspaceStore } from "./workspaceStore";

const cleanups: string[] = [];

async function folder(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workspacePathsFrom", () => {
  it("should put the default workspace in the documents folder", async () => {
    const documents = await folder("suite-planner-documents-");
    const paths = workspacePathsFrom(documents);

    expect(paths.workspace).toBe(join(documents, "workspace.planner"));
    expect(paths.backup).toBe(join(documents, "workspace.backup.planner"));
    expect(paths.temp).toBe(join(documents, "workspace.planner.tmp"));
  });

  it("should keep the backup and temporary file beside a named file", async () => {
    const paths = workspacePathsFrom("/documents/Suite/Planner", "/elsewhere/Field notes.planner");

    expect(paths.dir).toBe("/elsewhere");
    expect(paths.workspace).toBe("/elsewhere/Field notes.planner");
    expect(paths.backup).toBe("/elsewhere/Field notes.backup.planner");
    expect(paths.temp).toBe("/elsewhere/Field notes.planner.tmp");
  });

  it("should ignore a blank file rather than opening the documents folder", async () => {
    const paths = workspacePathsFrom("/documents/Suite/Planner", "   ");
    expect(paths.workspace).toBe(join("/documents/Suite/Planner", "workspace.planner"));
  });
});

describe("adoptLegacyWorkspace", () => {
  it("should copy the workspace and its backup into the documents folder", async () => {
    const legacy = await folder("suite-planner-legacy-");
    const documents = await folder("suite-planner-documents-");
    await writeFile(join(legacy, "workspace.planner"), "current", "utf8");
    await writeFile(join(legacy, "workspace.backup.planner"), "previous", "utf8");

    const destination = workspacePathsFrom(documents);
    const copied = await adoptLegacyWorkspace(destination, legacy);

    expect(copied).toEqual([destination.workspace, destination.backup]);
    expect(await readFile(destination.workspace, "utf8")).toBe("current");
    expect(await readFile(destination.backup, "utf8")).toBe("previous");
    // The original stays: a migration that deletes the only copy is how work disappears.
    expect(await readFile(join(legacy, "workspace.planner"), "utf8")).toBe("current");
  });

  it("should do nothing when a workspace is already in the documents folder", async () => {
    const legacy = await folder("suite-planner-legacy-");
    const documents = await folder("suite-planner-documents-");
    await writeFile(join(legacy, "workspace.planner"), "old", "utf8");
    await writeFile(join(documents, "workspace.planner"), "new", "utf8");

    const destination = workspacePathsFrom(documents);
    expect(await adoptLegacyWorkspace(destination, legacy)).toEqual([]);
    expect(await readFile(destination.workspace, "utf8")).toBe("new");
  });

  it("should do nothing when there is no legacy workspace", async () => {
    const legacy = await folder("suite-planner-legacy-");
    const documents = await folder("suite-planner-documents-");
    expect(await adoptLegacyWorkspace(workspacePathsFrom(documents), legacy)).toEqual([]);
  });

  it("should do nothing when the destination is the legacy folder", async () => {
    const legacy = await folder("suite-planner-legacy-");
    await writeFile(join(legacy, "workspace.planner"), "current", "utf8");
    await mkdir(join(legacy, "nested"), { recursive: true });

    const destination = workspacePathsFrom(legacy);
    expect(await adoptLegacyWorkspace(destination, legacy)).toEqual([]);
  });
});

describe("pre-release isolation", () => {
  it("creates the default pre-release workspace in its own folder", async () => {
    const documents = await folder("suite-planner-documents-");
    const slop = slopWorkspaceFolder(documents);
    const stable = workspacePathsFrom(join(documents, "Suite", "Planner"));

    expect(slop).toBe(join(documents, "Suite Slop", "Planner"));
    expect(workspacePathsFrom(slop).workspace).toBe(join(slop, "workspace.planner"));

    const store = await WorkspaceStore.open(workspacePathsFrom(slop));
    await store.flush();

    expect((await stat(join(slop, "workspace.planner"))).isFile()).toBe(true);
    await expect(stat(stable.workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("copies a stable workspace before opening it and leaves the original alone", async () => {
    const documents = await folder("suite-planner-documents-");
    const stableDir = join(documents, "Suite", "Planner");
    const slopDir = slopWorkspaceFolder(documents);
    const stablePaths = workspacePathsFrom(stableDir);

    const stable = await WorkspaceStore.open(stablePaths);
    await stable.flush();

    const original = await readFile(stablePaths.workspace);
    const before = await stat(stablePaths.workspace);

    const opened = await adoptChannelWorkspace(stablePaths.workspace, {
      channel: "slop",
      folder: slopDir,
    });
    const copy = await WorkspaceStore.open(workspacePathsFrom(slopDir, opened));
    await copy.flush();
    await copy.close();

    expect(opened).toBe(join(slopDir, "workspace.planner"));
    // Bytes and mtime together: neither an open nor a save may reach the stable file.
    expect(await readFile(stablePaths.workspace)).toEqual(original);
    expect((await stat(stablePaths.workspace)).mtimeMs).toBe(before.mtimeMs);
    // The stable backup and temporary file are not created or touched either.
    await expect(stat(stablePaths.backup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(stablePaths.temp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("opens an existing copy rather than overwriting work already done in the channel", async () => {
    const documents = await folder("suite-planner-documents-");
    const stableDir = join(documents, "Suite", "Planner");
    const slopDir = slopWorkspaceFolder(documents);
    await mkdir(stableDir, { recursive: true });
    const stableFile = join(stableDir, "workspace.planner");
    await writeFile(stableFile, "stable bytes", "utf8");

    const opened = await adoptChannelWorkspace(stableFile, { channel: "slop", folder: slopDir });
    await writeFile(opened, "channel bytes", "utf8");
    const again = await adoptChannelWorkspace(stableFile, { channel: "slop", folder: slopDir });

    expect(again).toBe(opened);
    expect(await readFile(again, "utf8")).toBe("channel bytes");
    expect(await readFile(stableFile, "utf8")).toBe("stable bytes");
  });

  it("leaves a stable build opening its own file in place", async () => {
    const documents = await folder("suite-planner-documents-");
    const stableFile = join(documents, "Suite", "Planner", "workspace.planner");
    await mkdir(join(documents, "Suite", "Planner"), { recursive: true });
    await writeFile(stableFile, "stable bytes", "utf8");

    const opened = await adoptChannelWorkspace(stableFile, {
      channel: "stable",
      folder: slopWorkspaceFolder(documents),
    });

    expect(opened).toBe(stableFile);
    expect(await readFile(stableFile, "utf8")).toBe("stable bytes");
  });

  it("cannot resolve the stable default from the pre-release folder", async () => {
    const documents = await folder("suite-planner-documents-");
    const stable = join(documents, "Suite", "Planner", "workspace.planner");
    const slop = slopWorkspaceFolder(documents);

    expect(
      workspaceFromLink(
        "suite://planner/workspace/workspace.planner",
        slop,
        (path) => path === stable,
      ),
    ).toBeNull();
    expect(
      workspaceFromLink("suite://planner/workspace/workspace.planner", slop, (path) =>
        path.startsWith(slop),
      ),
    ).toBe(join(slop, "workspace.planner"));
  });
});

describe("workspaceFromLink", () => {
  const folder = "/home/me/Documents/Suite/Planner";
  const present = () => true;

  it("resolves a link to the named workspace in the documents folder", () => {
    expect(workspaceFromLink("suite://planner/workspace/2026-Q4.planner", folder, present)).toBe(
      `${folder}/2026-Q4.planner`,
    );
  });

  it("refuses a file that is not there", () => {
    expect(workspaceFromLink("suite://planner/workspace/moved.planner", folder, () => false)).toBe(
      null,
    );
  });

  it("refuses a name that is not a planner workspace", () => {
    expect(workspaceFromLink("suite://planner/workspace/notes.txt", folder, present)).toBeNull();
    expect(workspaceFromLink("suite://planner/workspace/a/b.planner", folder, present)).toBeNull();
  });

  it("refuses a link that names another app", () => {
    expect(workspaceFromLink("suite://budget/workspace/x.budget", folder, present)).toBeNull();
  });

  it("refuses a path, which is the other spelling it accepts", () => {
    expect(workspaceFromLink("/tmp/x.planner", folder, present)).toBeNull();
  });
});

describe("workspaceFromArgv", () => {
  const folder = "/home/me/Documents/Suite/Planner";
  const present = () => true;
  const argv = (...args: string[]) => ["/usr/bin/suite-planner", ...args];

  it("reads a path the desktop handed over", () => {
    expect(workspaceFromArgv(argv("/tmp/x.planner"), folder, present)).toBe("/tmp/x.planner");
  });

  it("reads a link the hub routed here", () => {
    expect(workspaceFromArgv(argv("suite://planner/workspace/q4.planner"), folder, present)).toBe(
      `${folder}/q4.planner`,
    );
  });

  it("never treats a link as a path", () => {
    // A link ends in `.planner` too, so the order of the two tests is the rule.
    expect(
      workspaceFromArgv(argv("suite://planner/workspace/gone.planner"), folder, () => false),
    ).toBe(null);
  });

  it("ignores flags and finds the file among them", () => {
    expect(workspaceFromArgv(argv("--no-sandbox", "/tmp/x.planner"), folder, present)).toBe(
      "/tmp/x.planner",
    );
  });
});
