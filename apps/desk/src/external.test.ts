import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ExternalDialog,
  ExternalFilesService,
  fileFilters,
  isSafeSuggestedName,
} from "./external.js";
import { type FilesScope, type FilesSender, filesScope, PackFilesService } from "./files.js";
import type { PackCapability } from "./shared.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

let root: string;
let files: PackFilesService;
let service: ExternalFilesService;
let chosenOpen: string | null;
let chosenSave: string | null;
let chosenFolder: string | null;
let openCalls: number;
let saveCalls: number;
let folderCalls: number;

const dialog: ExternalDialog = {
  async pickOpen() {
    openCalls += 1;
    return chosenOpen;
  },
  async pickSave() {
    saveCalls += 1;
    return chosenSave;
  },
  async pickFolder() {
    folderCalls += 1;
    return chosenFolder;
  },
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-desk-external-"));
  files = new PackFilesService(join(root, "files"));
  service = new ExternalFilesService(dialog, files);
  chosenOpen = null;
  chosenSave = null;
  chosenFolder = null;
  openCalls = 0;
  saveCalls = 0;
  folderCalls = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sender(
  packId: string,
  options: {
    readonly owner?: string;
    readonly containerId?: string;
    readonly capabilities?: readonly PackCapability[];
  } = {},
): FilesSender {
  return {
    containerId: options.containerId ?? "default",
    packId,
    tabId: options.owner ?? "tab-1",
    pack: { capabilities: options.capabilities ?? ["files"] },
  };
}

function scopeOf(who: FilesSender): FilesScope {
  const found = filesScope(who);
  if (found === null) throw new Error("expected a files scope");
  return found;
}

async function sourceFile(name: string, text: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, text);
  return path;
}

describe("external file filters", () => {
  it("accepts a display name and bare lower-case extensions", () => {
    expect(fileFilters([{ name: "Text files", extensions: ["txt", "md"] }])).toEqual([
      { name: "Text files", extensions: ["txt", "md"] },
    ]);
    expect(fileFilters(undefined)).toEqual([]);
    expect(fileFilters([])).toEqual([]);
  });

  it("copies the filter instead of forwarding the renderer's object", () => {
    const input = { name: "CSV", extensions: ["csv"] };
    const [clean] = fileFilters([input]);
    expect(clean).not.toBe(input);
    expect(clean?.extensions).not.toBe(input.extensions);
  });

  it.each([
    ["a path in the name", [{ name: "../notes", extensions: ["txt"] }]],
    ["a slash in the name", [{ name: "docs/txt", extensions: ["txt"] }]],
    ["a glob in the name", [{ name: "*.txt", extensions: ["txt"] }]],
    ["an empty name", [{ name: "", extensions: ["txt"] }]],
    ["a dotted extension", [{ name: "Text", extensions: [".txt"] }]],
    ["an upper-case extension", [{ name: "Text", extensions: ["TXT"] }]],
    ["a glob extension", [{ name: "Text", extensions: ["*"] }]],
    ["an extension with a slash", [{ name: "Text", extensions: ["a/b"] }]],
    ["no extensions", [{ name: "Text", extensions: [] }]],
    ["a non-array", "txt"],
    ["a bare string entry", ["txt"]],
    ["too many extensions", [{ name: "Text", extensions: Array(33).fill("txt") }]],
  ])("refuses %s", (_label, value) => {
    expect(() => fileFilters(value)).toThrow(/invalid file filter/u);
  });
});

describe("the suggested save name", () => {
  it("accepts a plain file name", () => {
    expect(isSafeSuggestedName("budget.csv")).toBe(true);
    expect(isSafeSuggestedName("Q3 report (draft)")).toBe(true);
  });

  it.each(["../budget.csv", "notes/budget.csv", "notes\\budget.csv", "", ".env"])(
    "refuses %s",
    (value) => {
      expect(isSafeSuggestedName(value)).toBe(false);
    },
  );
});

describe("the external file service", () => {
  it("returns an opaque handle with a name, size and mtime and no path", async () => {
    const path = await sourceFile("note.txt", "hello");
    chosenOpen = path;

    const issued = await service.pickOpen(sender("welcome"), undefined);
    expect(issued).not.toBeNull();
    expect(issued?.info.name).toBe("note.txt");
    expect(issued?.info.size).toBe(5);
    expect(issued?.info.mtimeMs).toEqual(expect.any(Number));
    expect(Object.keys(issued?.info ?? {}).sort()).toEqual(["mtimeMs", "name", "size"]);
    expect(JSON.stringify(issued)).not.toContain(root);
  });

  it("reads and writes through the token", async () => {
    const path = await sourceFile("note.txt", "hello");
    chosenOpen = path;
    const who = sender("welcome");

    const issued = await service.pickOpen(who, undefined);
    if (issued === null) throw new Error("expected a handle");
    expect(decode(await service.read(who, issued.token))).toBe("hello");

    await service.write(who, issued.token, encode("next"));
    expect(await readFile(path, "utf8")).toBe("next");

    await service.close(who, issued.token);
    await expect(service.read(who, issued.token)).rejects.toThrow("not available");
  });

  it("treats cancellation as a null value, not an error", async () => {
    chosenOpen = null;
    chosenSave = null;
    expect(await service.pickOpen(sender("welcome"), undefined)).toBeNull();
    expect(await service.pickSave(sender("welcome"), "note.txt")).toBeNull();
  });

  it("does not create or truncate a save destination until the pack writes", async () => {
    const path = await sourceFile("existing.txt", "keep");
    chosenSave = path;

    const issued = await service.pickSave(sender("welcome"), "existing.txt");
    expect(issued?.info).toMatchObject({ name: "existing.txt", size: 4 });
    expect(await readFile(path, "utf8")).toBe("keep");

    if (issued === null) throw new Error("expected a handle");
    await service.write(sender("welcome"), issued.token, encode("replaced"));
    expect(await readFile(path, "utf8")).toBe("replaced");
  });

  it("creates a new save destination only when the pack writes", async () => {
    const path = join(root, "new.txt");
    chosenSave = path;

    await service.pickSave(sender("welcome"), "new.txt");
    await expect(stat(path)).rejects.toThrow();
  });

  it("refuses a destination that is a directory", async () => {
    const directory = await mkdtemp(join(root, "destination-"));
    chosenSave = directory;
    await expect(service.pickSave(sender("welcome"), "folder")).rejects.toThrow(
      "not a regular file",
    );
  });

  it("refuses an oversized write without touching the destination", async () => {
    service = new ExternalFilesService(dialog, files, { maxBytes: 4 });
    const path = await sourceFile("existing.txt", "keep");
    chosenSave = path;

    const issued = await service.pickSave(sender("welcome"), "existing.txt");
    if (issued === null) throw new Error("expected a handle");
    await expect(
      service.write(sender("welcome"), issued.token, encode("too large")),
    ).rejects.toThrow("too large");
    expect(await readFile(path, "utf8")).toBe("keep");
  });

  // A read-only directory proves the atomic promise: the temporary sibling
  // cannot be created, and the previous destination is left exactly as it was.
  const canRefuseWrites = process.platform !== "win32" && (process.getuid?.() ?? 0) !== 0;
  it.skipIf(!canRefuseWrites)(
    "leaves the previous file in place when a write cannot start",
    async () => {
      const directory = await mkdtemp(join(root, "locked-"));
      const path = join(directory, "existing.txt");
      await writeFile(path, "keep");
      chosenSave = path;

      const issued = await service.pickSave(sender("welcome"), "existing.txt");
      if (issued === null) throw new Error("expected a handle");
      await chmod(directory, 0o555);
      try {
        await expect(
          service.write(sender("welcome"), issued.token, encode("lost")),
        ).rejects.toThrow("could not be written");
      } finally {
        await chmod(directory, 0o755);
      }
      expect(await readFile(path, "utf8")).toBe("keep");
    },
  );

  it("refuses a pack that did not declare files, before the dialog opens", async () => {
    chosenOpen = await sourceFile("note.txt", "hello");
    const denied = sender("welcome", { capabilities: ["documents"] });

    await expect(service.pickOpen(denied, undefined)).rejects.toThrow("not enabled");
    await expect(service.pickSave(denied, "note.txt")).rejects.toThrow("not enabled");
    expect(openCalls).toBe(0);
    expect(saveCalls).toBe(0);
  });

  it("refuses another pack's token and does not let it close the handle", async () => {
    chosenOpen = await sourceFile("note.txt", "hello");
    const owner = sender("welcome", { owner: "tab-a" });
    const issued = await service.pickOpen(owner, undefined);
    if (issued === null) throw new Error("expected a handle");

    const otherPack = sender("other", { owner: "tab-a" });
    await expect(service.read(otherPack, issued.token)).rejects.toThrow("not available");
    await expect(service.write(otherPack, issued.token, encode("no"))).rejects.toThrow(
      "not available",
    );
    await expect(service.importFile(otherPack, issued.token)).rejects.toThrow("not available");

    // A cross-pack close is a no-op, so the real owner still holds the file.
    await service.close(otherPack, issued.token);
    expect(decode(await service.read(owner, issued.token))).toBe("hello");
  });

  it("refuses a token from another tab of the same pack", async () => {
    chosenOpen = await sourceFile("note.txt", "hello");
    const issued = await service.pickOpen(sender("welcome", { owner: "tab-a" }), undefined);
    if (issued === null) throw new Error("expected a handle");

    await expect(service.read(sender("welcome", { owner: "tab-b" }), issued.token)).rejects.toThrow(
      "not available",
    );
  });

  it("releases a destroyed view's handles and keeps other tabs' handles", async () => {
    const first = await sourceFile("first.txt", "one");
    chosenOpen = first;
    const heldByA = await service.pickOpen(sender("welcome", { owner: "tab-a" }), undefined);

    const second = await sourceFile("second.txt", "two");
    chosenOpen = second;
    const heldByB = await service.pickOpen(sender("welcome", { owner: "tab-b" }), undefined);
    if (heldByA === null || heldByB === null) throw new Error("expected handles");

    service.releaseOwner("tab-a");
    await expect(
      service.read(sender("welcome", { owner: "tab-a" }), heldByA.token),
    ).rejects.toThrow("not available");
    expect(decode(await service.read(sender("welcome", { owner: "tab-b" }), heldByB.token))).toBe(
      "two",
    );
  });

  it("imports an open file into the pack's own files root", async () => {
    chosenOpen = await sourceFile("budget.csv", "amount\n12\n");
    const who = sender("welcome");
    const issued = await service.pickOpen(who, undefined);
    if (issued === null) throw new Error("expected a handle");

    const entry = await service.importFile(who, issued.token);
    expect(entry).toMatchObject({
      path: "budget.csv",
      name: "budget.csv",
      kind: "file",
      size: 10,
    });
    expect(entry.path).not.toContain(root);
    expect(decode(await files.read(scopeOf(who), entry.path))).toBe("amount\n12\n");
  });

  it("imports under a pack-provided relative name", async () => {
    chosenOpen = await sourceFile("budget.csv", "amount\n12\n");
    const who = sender("welcome");
    const issued = await service.pickOpen(who, undefined);
    if (issued === null) throw new Error("expected a handle");

    const entry = await service.importFile(who, issued.token, "imports/budget.csv");
    expect(entry.path).toBe("imports/budget.csv");
    expect(entry.name).toBe("budget.csv");
  });

  it("refuses an import that would leave the pack root", async () => {
    chosenOpen = await sourceFile("budget.csv", "amount\n12\n");
    const who = sender("welcome");
    const issued = await service.pickOpen(who, undefined);
    if (issued === null) throw new Error("expected a handle");

    await expect(service.importFile(who, issued.token, "../escape.csv")).rejects.toThrow(
      "could not be imported",
    );
    await expect(service.importFile(who, issued.token, "/tmp/escape.csv")).rejects.toThrow(
      "could not be imported",
    );
  });

  it("refuses an import that grew past the cap after it was picked", async () => {
    service = new ExternalFilesService(dialog, files, { maxBytes: 8 });
    const path = await sourceFile("grew.txt", "four");
    chosenOpen = path;
    const who = sender("welcome");

    const issued = await service.pickOpen(who, undefined);
    if (issued === null) throw new Error("expected a handle");
    await writeFile(path, "far too long for the cap");

    await expect(service.importFile(who, issued.token)).rejects.toThrow("too large");
    expect(await files.stat(scopeOf(who), "grew.txt")).toBeNull();
  });

  it("does not put a path in an error", async () => {
    const path = join(root, "missing.txt");
    chosenOpen = path;
    const error = await service
      .pickOpen(sender("welcome"), undefined)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).not.toContain(root);
      expect(error.message).not.toContain("missing.txt");
    }
  });
});

describe("folder import", () => {
  async function folder(name: string, files: Record<string, string>): Promise<string> {
    const directory = join(root, name);
    for (const [relative, text] of Object.entries(files)) {
      const target = join(directory, relative);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, text);
    }
    await mkdir(directory, { recursive: true });
    return directory;
  }

  it("copies a nested folder into the pack root and returns relative entries", async () => {
    chosenFolder = await folder("vault", {
      "Home.md": "# Home",
      "notes/Alpha.md": "alpha",
    });
    const who = sender("canvas");
    const imported = await service.importFolder(who);

    expect(imported?.path).toBe("imports/vault");
    expect(imported?.entries.map((entry) => entry.path).sort()).toEqual([
      "imports/vault/Home.md",
      "imports/vault/notes/Alpha.md",
    ]);
    expect(JSON.stringify(imported)).not.toContain(root);
    expect(decode(await files.read(scopeOf(who), "imports/vault/notes/Alpha.md"))).toBe("alpha");
  });

  it("gives a second import of the same folder a free name", async () => {
    chosenFolder = await folder("vault", { "Home.md": "# Home" });
    const who = sender("canvas");

    expect((await service.importFolder(who))?.path).toBe("imports/vault");
    expect((await service.importFolder(who))?.path).toBe("imports/vault-2");
  });

  it("refuses a destination that already holds something", async () => {
    chosenFolder = await folder("vault", { "Home.md": "# Home" });
    const who = sender("canvas");
    await files.write(scopeOf(who), "imports/taken/old.md", encode("old"));

    await expect(service.importFolder(who, "imports/taken")).rejects.toThrow("already exists");
    // The old copy is untouched: a collision refuses, it does not merge.
    expect(await files.stat(scopeOf(who), "imports/taken/old.md")).not.toBeNull();
  });

  it("treats cancellation as a null value", async () => {
    chosenFolder = null;
    expect(await service.importFolder(sender("canvas"))).toBeNull();
  });

  it("refuses a pack without files before the folder dialog opens", async () => {
    chosenFolder = await folder("vault", { "Home.md": "# Home" });
    await expect(
      service.importFolder(sender("canvas", { capabilities: ["documents"] })),
    ).rejects.toThrow("not enabled");
    expect(folderCalls).toBe(0);
  });

  it.each([
    [
      "too many entries",
      { maxEntries: 2 },
      { "a.md": "a", "b.md": "b", "c.md": "c" },
      "more files",
    ],
    ["an oversized file", { maxFileBytes: 4 }, { "big.md": "too large" }, "larger than"],
    [
      "too many bytes",
      { maxTotalBytes: 6 },
      { "a.md": "1234", "b.md": "5678" },
      "larger than this host",
    ],
  ])("refuses %s and writes nothing", async (_label, limits, contents, message) => {
    chosenFolder = await folder("bounded", contents);
    service = new ExternalFilesService(dialog, files, { folderLimits: limits });
    const who = sender("canvas");

    await expect(service.importFolder(who)).rejects.toThrow(message);
    expect(await files.stat(scopeOf(who), "imports/bounded")).toBeNull();
  });

  it("refuses a symlink and writes nothing", async () => {
    const directory = await folder("linked", { "real.md": "real" });
    await symlink(join(directory, "real.md"), join(directory, "alias.md"));
    chosenFolder = directory;
    const who = sender("canvas");

    await expect(service.importFolder(who)).rejects.toThrow("symbolic link");
    expect(await files.stat(scopeOf(who), "imports/linked")).toBeNull();
  });

  it("refuses a destination that leaves the pack root", async () => {
    chosenFolder = await folder("vault", { "Home.md": "# Home" });
    const who = sender("canvas");

    await expect(service.importFolder(who, "../escape")).rejects.toThrow(
      "invalid folder destination",
    );
    await expect(service.importFolder(who, "/tmp/escape")).rejects.toThrow(
      "invalid folder destination",
    );
  });
});
