import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStoreError } from "@suite/pack-host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FilesScope, filesScope, navigationReleasesLocks, PackFilesService } from "./files.js";
import type { PackCapability } from "./shared.js";

let root: string;
let service: PackFilesService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-shell-files-"));
  service = new PackFilesService(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function codeOf(value: unknown): string | undefined {
  return value instanceof FileStoreError ? value.code : undefined;
}

function scope(
  packId: string,
  options: {
    readonly owner?: string;
    readonly containerId?: string;
    readonly capabilities?: readonly PackCapability[];
  } = {},
): FilesScope {
  const found = filesScope({
    containerId: options.containerId ?? "default",
    packId,
    tabId: options.owner ?? "tab-1",
    pack: { capabilities: options.capabilities ?? ["files"] },
  });
  if (found === null) throw new Error("expected a files scope");
  return found;
}

describe("the files service", () => {
  it("writes, lists, reads, renames, backs up and removes inside one pack", async () => {
    const welcome = scope("welcome");

    await service.write(welcome, "notes/first.txt", encode("hello"));
    expect(decode(await service.read(welcome, "notes/first.txt"))).toBe("hello");
    expect((await service.list(welcome, "notes")).map((entry) => entry.name)).toEqual([
      "first.txt",
    ]);
    expect((await service.stat(welcome, "notes/first.txt"))?.size).toBe(5);

    await service.mkdir(welcome, "empty");
    expect((await service.stat(welcome, "empty"))?.kind).toBe("directory");

    const backup = await service.backup(welcome, "notes/first.txt");
    expect(backup.startsWith("notes/first.txt.")).toBe(true);
    expect(decode(await service.read(welcome, backup))).toBe("hello");

    await service.rename(welcome, "notes/first.txt", "notes/second.txt");
    expect(await service.stat(welcome, "notes/first.txt")).toBeNull();
    expect(decode(await service.read(welcome, "notes/second.txt"))).toBe("hello");

    await service.remove(welcome, "notes/second.txt");
    expect(await service.stat(welcome, "notes/second.txt")).toBeNull();
  });

  it("does not let one pack read another pack's file", async () => {
    const welcome = scope("welcome");
    const scratch = scope("scratch");

    await service.write(welcome, "private.txt", encode("welcome only"));

    expect(await service.stat(scratch, "private.txt")).toBeNull();
    expect(await service.list(scratch)).toEqual([]);
    await expect(service.read(scratch, "private.txt")).rejects.toSatisfy(
      (error) => codeOf(error) === "not-found",
    );
  });

  it("keeps containers apart even for the same pack id", async () => {
    const personal = scope("welcome", { containerId: "default" });
    const work = scope("welcome", { containerId: "work" });

    await service.write(personal, "note.txt", encode("personal"));

    expect(await service.stat(work, "note.txt")).toBeNull();
    await expect(service.read(work, "note.txt")).rejects.toSatisfy(
      (error) => codeOf(error) === "not-found",
    );
  });

  it("refuses a path that climbs out of the pack", async () => {
    const welcome = scope("welcome");

    for (const attempt of ["../outside.txt", "/etc/passwd", "notes/../../outside.txt"]) {
      await expect(service.read(welcome, attempt)).rejects.toSatisfy(
        (error) => codeOf(error) === "invalid-path",
      );
      await expect(service.write(welcome, attempt, encode("no"))).rejects.toSatisfy(
        (error) => codeOf(error) === "invalid-path",
      );
    }
  });

  it("gives no scope to a pack that did not declare files", () => {
    const denied = filesScope({
      containerId: "default",
      packId: "welcome",
      tabId: "tab-1",
      pack: { capabilities: ["documents"] },
    });
    expect(denied).toBeNull();
  });

  it("gives no scope to an invalid container or pack id", () => {
    expect(
      filesScope({
        containerId: "../default",
        packId: "welcome",
        tabId: "tab-1",
        pack: { capabilities: ["files"] },
      }),
    ).toBeNull();
    expect(
      filesScope({
        containerId: "default",
        packId: "../welcome",
        tabId: "tab-1",
        pack: { capabilities: ["files"] },
      }),
    ).toBeNull();
  });

  it("holds a lock until it is released", async () => {
    const welcome = scope("welcome", { owner: "tab-a" });

    const issued = await service.lock(welcome, "note.txt");
    await expect(service.lock(welcome, "note.txt")).rejects.toSatisfy(
      (error) => codeOf(error) === "locked",
    );

    await service.unlock(welcome, issued.token);
    const again = await service.lock(welcome, "note.txt");
    await service.unlock(welcome, again.token);
  });

  it("releases a destroyed view's locks by owner", async () => {
    const welcome = scope("welcome", { owner: "tab-a" });

    await service.lock(welcome, "note.txt");
    service.releaseOwner("tab-a");

    const again = await service.lock(welcome, "note.txt");
    await service.unlock(welcome, again.token);
  });

  it("releases locks when a navigation replaces the page", () => {
    expect(navigationReleasesLocks(true, false)).toBe(true);
    // Same-document navigation keeps the page, and a subframe owns no tokens.
    expect(navigationReleasesLocks(true, true)).toBe(false);
    expect(navigationReleasesLocks(false, false)).toBe(false);
  });

  it("does not let another tab spend a lock token", async () => {
    const first = scope("welcome", { owner: "tab-a" });
    const second = scope("welcome", { owner: "tab-b" });

    const issued = await service.lock(first, "note.txt");
    await service.unlock(second, issued.token);
    await expect(service.lock(second, "note.txt")).rejects.toSatisfy(
      (error) => codeOf(error) === "locked",
    );

    await service.unlock(first, issued.token);
    const again = await service.lock(second, "note.txt");
    await service.unlock(second, again.token);
  });
});
