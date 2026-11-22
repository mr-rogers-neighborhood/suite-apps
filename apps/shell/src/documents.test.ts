import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentStore } from "./documents.js";

let root: string;
let store: DocumentStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-shell-documents-"));
  store = new DocumentStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("the document store", () => {
  it("creates, writes, reads and lists a pack's document", async () => {
    const created = await store.create("default", "welcome", "first.note");
    expect(created.name).toBe("first.note");

    await store.save("default", "welcome", "first.note", encode("hello"));
    const opened = await store.open("default", "welcome", "first.note");
    expect(opened).not.toBeNull();
    expect(decode(opened?.bytes ?? new Uint8Array())).toBe("hello");

    const listed = await store.list("default", "welcome");
    expect(listed.map((entry) => entry.name)).toEqual(["first.note"]);
    expect(listed[0]?.size).toBe(5);
  });

  it("does not let one pack open another pack's document", async () => {
    await store.create("default", "welcome", "shared.note");
    await store.save("default", "welcome", "shared.note", encode("welcome only"));

    expect(await store.open("default", "scratch", "shared.note")).toBeNull();
    expect(await store.list("default", "scratch")).toEqual([]);
  });

  it("keeps containers apart even for the same pack id", async () => {
    await store.create("default", "welcome", "note.note");
    await store.save("default", "welcome", "note.note", encode("personal"));

    expect(await store.open("work", "welcome", "note.note")).toBeNull();
    expect(await store.list("work", "welcome")).toEqual([]);
    expect(
      decode((await store.open("default", "welcome", "note.note"))?.bytes ?? new Uint8Array()),
    ).toBe("personal");
  });

  it("refuses an invalid container id", async () => {
    await expect(store.list("../default", "welcome")).rejects.toThrow("invalid container id");
  });

  it("refuses a name that climbs out of the pack", async () => {
    await expect(store.create("default", "welcome", "../secret.note")).rejects.toThrow(
      "invalid document name",
    );
    await expect(store.open("default", "welcome", "../../etc/passwd")).rejects.toThrow(
      "invalid document name",
    );
    await expect(store.save("default", "welcome", "a/b", encode("no"))).rejects.toThrow(
      "invalid document name",
    );
  });

  it("refuses an invalid pack id", async () => {
    await expect(store.list("default", "../welcome")).rejects.toThrow("invalid pack id");
  });

  it("refuses to create a document twice without leaking a path", async () => {
    await store.create("default", "welcome", "once.note");
    await expect(store.create("default", "welcome", "once.note")).rejects.toThrow(
      "document already exists",
    );
    try {
      await store.create("default", "welcome", "once.note");
    } catch (error) {
      expect(String(error)).not.toContain(root);
    }
  });

  it("refuses to follow a symlink out of the pack", async () => {
    const outside = join(root, "outside.txt");
    await writeFile(outside, "not the pack's");
    await store.create("default", "welcome", "placeholder.note");
    await symlink(outside, join(root, "default", "welcome", "link.note"));

    await expect(store.open("default", "welcome", "link.note")).rejects.toThrow(
      "not a regular file",
    );
    await expect(store.save("default", "welcome", "link.note", encode("no"))).rejects.toThrow(
      "not a regular file",
    );
    expect((await store.list("default", "welcome")).map((entry) => entry.name)).toEqual([
      "placeholder.note",
    ]);
  });

  it("removes only the named document", async () => {
    await store.create("default", "welcome", "one.note");
    await store.create("default", "welcome", "two.note");
    await store.remove("default", "welcome", "one.note");

    expect((await store.list("default", "welcome")).map((entry) => entry.name)).toEqual([
      "two.note",
    ]);
  });

  it("refuses a document larger than the limit", async () => {
    await store.create("default", "welcome", "big.note");
    const tooLarge = new Uint8Array(64 * 1024 * 1024 + 1);
    await expect(store.save("default", "welcome", "big.note", tooLarge)).rejects.toThrow(
      "too large",
    );
  });
});
