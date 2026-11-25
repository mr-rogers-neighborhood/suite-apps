import { FileStoreError } from "@suite/pack-host/files/core";
import { describe, expect, it } from "vitest";
import {
  createPackFilesWith,
  GoPackFileStore,
  type PackFileBackend,
  packFilesRoot,
  packFilesScopeOf,
  packFilesSegment,
} from "./packFiles.js";

/**
 * The Go pack file store, over a fake filesystem.
 *
 * The real backend is Capacitor's Filesystem plugin, whose API is the same
 * shape: `stat` returns `file`, `directory` or (on a hostile platform) a link,
 * paths are relative to the app's private data directory, and there is no
 * `realpath`. Every refusal the store promises is reachable here without a
 * device, which is the point of the seam.
 */
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

function errorCode(value: unknown): string | undefined {
  return value instanceof FileStoreError ? value.code : undefined;
}

class MemoryBackend implements PackFileBackend {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>();
  /** Paths the fake platform reports as a link, so the store must refuse them. */
  readonly links = new Set<string>();
  readonly mtimes = new Map<string, number>();
  readonly written: string[] = [];
  clock = 1_000;

  async read(path: string): Promise<Uint8Array> {
    const found = this.files.get(path);
    if (found === undefined) throw new Error("no such file");
    return found;
  }

  async write(path: string, value: Uint8Array): Promise<void> {
    this.written.push(path);
    this.files.set(path, value);
    this.directories.delete(path);
    this.clock += 10;
    this.mtimes.set(path, this.clock);
  }

  async mkdir(path: string): Promise<void> {
    const parts = path.split("/");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      this.directories.add(parts.slice(0, depth).join("/"));
    }
  }

  async readdir(path: string): Promise<readonly { name: string; type: string }[]> {
    if (!this.directories.has(path)) throw new Error("no such directory");
    const prefix = `${path}/`;
    const seen = new Map<string, string>();
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.directories, ...this.links]) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name === undefined || name.length === 0) continue;
      names.add(name);
    }
    for (const name of names) {
      const full = `${prefix}${name}`;
      if (this.links.has(full)) seen.set(name, "symlink");
      else if (this.directories.has(full)) seen.set(name, "directory");
      else seen.set(name, "file");
    }
    return [...seen].map(([name, type]) => ({ name, type }));
  }

  async stat(path: string): Promise<{ type: string; size: number; mtimeMs: number } | null> {
    if (this.links.has(path)) return { type: "symlink", size: 0, mtimeMs: 0 };
    const file = this.files.get(path);
    if (file !== undefined) {
      return { type: "file", size: file.byteLength, mtimeMs: this.mtimes.get(path) ?? 0 };
    }
    if (this.directories.has(path)) return { type: "directory", size: 0, mtimeMs: 0 };
    return null;
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.files.has(from)) {
      this.files.set(to, this.files.get(from) as Uint8Array);
      this.files.delete(from);
      this.mtimes.set(to, this.mtimes.get(from) ?? 0);
      this.mtimes.delete(from);
      return;
    }
    if (!this.directories.has(from)) throw new Error("no such path");
    for (const key of [...this.files.keys(), ...this.directories]) {
      if (key !== from && !key.startsWith(`${from}/`)) continue;
      const moved = `${to}${key.slice(from.length)}`;
      if (this.files.has(key)) {
        this.files.set(moved, this.files.get(key) as Uint8Array);
        this.files.delete(key);
      } else {
        this.directories.add(moved);
        this.directories.delete(key);
      }
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const found = this.files.get(from);
    if (found === undefined) throw new Error("no such file");
    this.files.set(to, new Uint8Array(found));
  }

  async removeFile(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error("no such file");
    this.mtimes.delete(path);
  }

  async removeDirectory(path: string, recursive: boolean): Promise<void> {
    if (!this.directories.has(path)) throw new Error("no such directory");
    const children = [...this.files.keys(), ...this.directories, ...this.links].filter((key) =>
      key.startsWith(`${path}/`),
    );
    if (!recursive && children.length > 0) throw new Error("directory is not empty");
    for (const key of children) {
      this.files.delete(key);
      this.directories.delete(key);
      this.links.delete(key);
    }
    this.directories.delete(path);
  }
}

async function storeFor(name: string, backend = new MemoryBackend()): Promise<GoPackFileStore> {
  return GoPackFileStore.open(packFilesRoot({ packId: name }), {
    backend,
    now: () => new Date("2026-11-24T12:00:00.000Z"),
  });
}

describe("Suite Go pack file store", () => {
  it("writes, reads, lists, stats and removes its own file", async () => {
    const backend = new MemoryBackend();
    const store = await storeFor("alpha", backend);

    const written = await store.write("notes/day.txt", bytes("hello"));
    expect(written).toEqual({
      path: "notes/day.txt",
      name: "day.txt",
      kind: "file",
      size: 5,
      mtimeMs: expect.any(Number),
    });

    expect(text(await store.read("notes/day.txt"))).toBe("hello");
    expect((await store.list("notes")).map((entry) => entry.name)).toEqual(["day.txt"]);
    expect((await store.list()).map((entry) => entry.name)).toEqual(["notes"]);
    expect((await store.stat("notes/day.txt"))?.size).toBe(5);
    expect(await store.stat("notes/missing.txt")).toBeNull();

    await store.remove("notes/day.txt");
    expect(await store.stat("notes/day.txt")).toBeNull();
    await expect(store.read("notes/day.txt")).rejects.toSatisfy(
      (error) => errorCode(error) === "not-found",
    );

    // Atomic by default: the temporary name is gone, and only the final path is visible.
    expect(backend.written.some((path) => path.includes(".tmp-"))).toBe(true);
    expect([...backend.files.keys()].some((path) => path.includes(".tmp-"))).toBe(false);
  });

  it("refuses traversal, absolute and backslash paths before touching the filesystem", async () => {
    const backend = new MemoryBackend();
    const store = await storeFor("alpha", backend);

    for (const attempt of ["../beta/secret.txt", "/etc/passwd", "a/../../b", "a\\b", "a\u0000b"]) {
      await expect(store.write(attempt, bytes("no"))).rejects.toSatisfy(
        (error) => errorCode(error) === "invalid-path",
      );
      await expect(store.read(attempt)).rejects.toSatisfy(
        (error) => errorCode(error) === "invalid-path",
      );
    }
    expect(backend.files.size).toBe(0);
  });

  it("keeps one pack's files out of another pack's store", async () => {
    const backend = new MemoryBackend();
    const alpha = await storeFor("alpha", backend);
    const beta = await storeFor("beta", backend);

    await alpha.write("notes/day.txt", bytes("alpha only"));

    expect(alpha.root).toBe("pack-files/alpha");
    expect(beta.root).toBe("pack-files/beta");
    expect(await beta.stat("notes/day.txt")).toBeNull();
    await expect(beta.read("notes/day.txt")).rejects.toSatisfy(
      (error) => errorCode(error) === "not-found",
    );
    expect(await beta.list()).toEqual([]);

    // The same relative path in beta is its own file, not alpha's.
    await beta.write("notes/day.txt", bytes("beta only"));
    expect(text(await alpha.read("notes/day.txt"))).toBe("alpha only");
    expect(text(await beta.read("notes/day.txt"))).toBe("beta only");
  });

  it("refuses a symlink or any non-regular entry instead of following it", async () => {
    const backend = new MemoryBackend();
    const store = await storeFor("alpha", backend);
    await store.write("real.txt", bytes("real"));
    backend.links.add(`${store.root}/linked.txt`);
    backend.links.add(`${store.root}/real.txt`);

    await expect(store.read("linked.txt")).rejects.toSatisfy(
      (error) => errorCode(error) === "symlink",
    );
    await expect(store.write("linked.txt", bytes("no"))).rejects.toSatisfy(
      (error) => errorCode(error) === "symlink",
    );
    // A link that replaced the final name is refused too, not written through.
    await expect(store.write("real.txt", bytes("over"))).rejects.toSatisfy(
      (error) => errorCode(error) === "symlink",
    );
    // Listing skips what it cannot treat as a file or a directory.
    await expect(store.list()).resolves.toEqual([]);
  });

  it("holds one writer per path and refuses a second lock", async () => {
    const store = await storeFor("alpha");
    const lock = store.lock("notes/day.txt");

    expect(lock.path).toBe("notes/day.txt");
    expect(() => store.lock("notes/day.txt")).toThrow(FileStoreError);
    expect(() => store.lock("notes/other.txt")).not.toThrow();

    await lock.release();
    expect(() => store.lock("notes/day.txt")).not.toThrow();

    // The frame's teardown drops everything the pack held.
    store.lock("notes/a.txt");
    store.releaseAll("pack");
    expect(() => store.lock("notes/a.txt")).not.toThrow();
  });

  it("backs a file up to a dated sibling without overwriting an earlier one", async () => {
    const store = await storeFor("alpha");
    await store.write("notes/day.txt", bytes("first"));

    const first = await store.backup("notes/day.txt");
    expect(first).toBe("notes/day.txt.2026-11-24T12-00-00-000Z.bak");
    expect(text(await store.read(first))).toBe("first");

    await store.write("notes/day.txt", bytes("second"));
    const second = await store.backup("notes/day.txt");
    expect(second).not.toBe(first);
    expect(text(await store.read(second))).toBe("second");
    expect(text(await store.read(first))).toBe("first");

    await expect(store.backup("notes")).rejects.toSatisfy(
      (error) => errorCode(error) === "not-a-file",
    );
  });

  it("creates nested directories, renames, and removes only when allowed", async () => {
    const store = await storeFor("alpha");
    await store.mkdir("a/b");
    await store.write("a/b/one.txt", bytes("one"));

    await store.rename("a/b/one.txt", "a/b/two.txt");
    expect(await store.stat("a/b/one.txt")).toBeNull();
    expect(text(await store.read("a/b/two.txt"))).toBe("one");

    await expect(store.remove("a")).rejects.toSatisfy((error) => errorCode(error) === "io");
    await store.remove("a", { recursive: true });
    expect(await store.list()).toEqual([]);
  });

  it("enforces the byte cap and a stale-writer conflict", async () => {
    const backend = new MemoryBackend();
    const store = await GoPackFileStore.open(packFilesRoot({ packId: "alpha" }), {
      backend,
      maxFileBytes: 4,
    });

    await expect(store.write("big.txt", bytes("hello"))).rejects.toSatisfy(
      (error) => errorCode(error) === "too-large",
    );

    const entry = await store.write("small.txt", bytes("one"));
    await expect(
      store.write("small.txt", bytes("two"), { expectedMtimeMs: entry.mtimeMs - 50 }),
    ).rejects.toSatisfy((error) => errorCode(error) === "conflict");

    await expect(
      store.write("small.txt", bytes("two"), { expectedMtimeMs: entry.mtimeMs }),
    ).resolves.toMatchObject({ size: 3 });
  });

  it("names one storage segment per publisher and pack", () => {
    expect(packFilesSegment({ packId: "planner" })).toBe("planner");
    expect(packFilesSegment({ packId: "planner", publisherId: "suite" })).toBe("planner");
    expect(packFilesSegment({ packId: "planner", publisherId: "other" })).toBe("other~planner");
    expect(packFilesScopeOf({ id: "planner" })).toEqual({ packId: "planner" });
    expect(packFilesScopeOf({ id: "planner", publisher: { id: "other" } })).toEqual({
      packId: "planner",
      publisherId: "other",
    });
  });

  it("exposes the scoped store and the person's picker as one service", async () => {
    const backend = new MemoryBackend();
    const files = createPackFilesWith({ packId: "alpha" }, { backend });

    await files.write("notes/day.txt", bytes("hello"));
    expect(text(await await files.read("notes/day.txt"))).toBe("hello");
    expect((await files.list()).map((entry) => entry.name)).toEqual(["notes"]);
    expect(typeof files.pickOpen).toBe("function");
    expect(typeof files.share).toBe("function");
  });
});
