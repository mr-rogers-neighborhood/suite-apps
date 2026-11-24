import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_MAGIC,
  DocumentRefusal,
  DocumentStore,
  encodeDocumentEnvelope,
} from "./documents.js";

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
const documentPath = (...parts: string[]): string => join(root, ...parts);
const checksumOf = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const flipLastByte = (bytes: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(bytes);
  const index = copy.byteLength - 1;
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
};

/** The payload bytes as they sit inside an envelope, without asking the store. */
async function payloadOnDisk(file: string, payloadLength: number): Promise<Uint8Array> {
  const whole = new Uint8Array(await readFile(file));
  return whole.subarray(whole.byteLength - payloadLength);
}

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
    // The size a pack sees is its payload, not the host header in front of it.
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

describe("the document envelope", () => {
  // spec: S6.1
  it("writes each header field and reads back the payload unchanged", async () => {
    const payload = encode('{"title":"a note","unknownField":"kept"}');
    await store.create("default", "welcome", "header.note");
    await store.save("default", "welcome", "header.note", payload);

    const header = await store.header("default", "welcome", "header.note");
    expect(header).toEqual({
      publisher: "suite",
      packId: "welcome",
      documentId: "header.note",
      schemaVersion: 1,
      payloadLength: payload.byteLength,
      payloadChecksum: checksumOf(payload),
    });

    const opened = await store.open("default", "welcome", "header.note");
    expect(opened?.bytes).toEqual(payload);

    const onDisk = new Uint8Array(
      await readFile(documentPath("default", "welcome", "header.note")),
    );
    expect(new TextDecoder().decode(onDisk.subarray(0, DOCUMENT_MAGIC.length))).toBe(
      DOCUMENT_MAGIC,
    );
  });

  // spec: S6.1
  it("reads the header without the payload, even when the payload is damaged", async () => {
    const payload = encode("the payload the host never parses");
    await store.create("default", "welcome", "header-only.note");
    await store.save("default", "welcome", "header-only.note", payload);

    // Damage the payload only: the header still describes a document of the
    // same length, so a header-only read is unaffected.
    const file = documentPath("default", "welcome", "header-only.note");
    const whole = new Uint8Array(await readFile(file));
    whole[whole.byteLength - 1] = 0x00;
    await writeFile(file, whole);

    const header = await store.header("default", "welcome", "header-only.note");
    expect(header?.payloadLength).toBe(payload.byteLength);
    expect(header?.payloadChecksum).toBe(checksumOf(payload));

    await expect(store.open("default", "welcome", "header-only.note")).rejects.toBeInstanceOf(
      DocumentRefusal,
    );
  });

  // spec: S6.1
  it("gives a created document a header and no payload", async () => {
    const created = await store.create("default", "welcome", "empty.note");
    expect(created.size).toBe(0);
    expect(await store.header("default", "welcome", "empty.note")).toMatchObject({
      payloadLength: 0,
      payloadChecksum: checksumOf(new Uint8Array()),
      documentId: "empty.note",
    });
    expect((await store.open("default", "welcome", "empty.note"))?.bytes).toEqual(new Uint8Array());
  });

  // spec: S6.2
  it("keeps the previous copy beside the document and never leaves a temporary behind", async () => {
    await store.create("default", "welcome", "backup.note");
    await store.save("default", "welcome", "backup.note", encode("first"));
    await store.save("default", "welcome", "backup.note", encode("second"));

    const names = await readdir(documentPath("default", "welcome"));
    expect(names).toContain("backup.note");
    expect(names).toContain("backup.note.bak");
    expect(names.some((name) => name.includes(".tmp-"))).toBe(false);

    // The previous copy is a whole envelope of its own, not a listed document.
    const backupBytes = new TextDecoder().decode(
      await payloadOnDisk(documentPath("default", "welcome", "backup.note.bak"), 5),
    );
    expect(backupBytes).toBe("first");
    expect(
      decode((await store.open("default", "welcome", "backup.note"))?.bytes ?? new Uint8Array()),
    ).toBe("second");
  });

  // spec: S6.2
  it("quarantines a corrupt envelope instead of replacing it with a fresh document", async () => {
    await store.create("default", "welcome", "damaged.note");
    await store.save("default", "welcome", "damaged.note", encode("the only copy"));

    const file = documentPath("default", "welcome", "damaged.note");
    const whole = flipLastByte(new Uint8Array(await readFile(file)));
    await writeFile(file, whole);

    const refusal = await store.open("default", "welcome", "damaged.note").catch((error) => error);
    expect(refusal).toBeInstanceOf(DocumentRefusal);
    expect((refusal as DocumentRefusal).kind).toBe("corrupt");
    expect((refusal as DocumentRefusal).message).toMatch(/could not be read/);
    expect((refusal as DocumentRefusal).exportPath).toContain("damaged.note.corrupt-");
    // The message names where the file went and never the absolute path.
    expect((refusal as DocumentRefusal).message).not.toContain(root);

    // The document is gone from its name and preserved under the quarantine
    // name; nothing fresh was written in its place.
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    const quarantined = (await readdir(documentPath("default", "welcome"))).filter((name) =>
      name.startsWith("damaged.note.corrupt-"),
    );
    expect(quarantined).toHaveLength(1);
    const kept = await readFile(documentPath("default", "welcome", quarantined[0] as string));
    expect(new Uint8Array(kept)).toEqual(whole);
  });

  // spec: S6.2
  it("refuses to save over a corrupt envelope and leaves it untouched", async () => {
    await store.create("default", "welcome", "unreadable.note");
    await store.save("default", "welcome", "unreadable.note", encode("keep me"));
    const file = documentPath("default", "welcome", "unreadable.note");
    const whole = flipLastByte(new Uint8Array(await readFile(file)));
    await writeFile(file, whole);

    await expect(
      store.save("default", "welcome", "unreadable.note", encode("replacement")),
    ).rejects.toBeInstanceOf(DocumentRefusal);
    expect(new Uint8Array(await readFile(file))).toEqual(whole);
  });

  // spec: S6.2
  it("restores the previous copy after a crash left the document missing", async () => {
    await store.create("default", "welcome", "crash.note");
    await store.save("default", "welcome", "crash.note", encode("before the crash"));

    const file = documentPath("default", "welcome", "crash.note");
    // The shape a crash between the backup and the rename leaves behind.
    await rename(file, `${file}.bak`);

    const opened = await store.open("default", "welcome", "crash.note");
    expect(decode(opened?.bytes ?? new Uint8Array())).toBe("before the crash");
  });

  // spec: S6.2
  it("discards an unfinished temporary file and keeps the last good document", async () => {
    await store.create("default", "welcome", "unfinished.note");
    await store.save("default", "welcome", "unfinished.note", encode("good"));
    const directory = documentPath("default", "welcome");
    await writeFile(
      join(directory, "unfinished.note.tmp-00000000-0000-4000-8000-000000000000"),
      "x",
    );

    expect(
      decode(
        (await store.open("default", "welcome", "unfinished.note"))?.bytes ?? new Uint8Array(),
      ),
    ).toBe("good");
    const names = await readdir(directory);
    expect(names.some((name) => name.includes(".tmp-"))).toBe(false);
    expect(names).not.toContain("unfinished.note.tmp-00000000-0000-4000-8000-000000000000");
  });

  // spec: S6.2
  it("serializes two saves to the same document so the last one is whole", async () => {
    await store.create("default", "welcome", "serial.note");
    await Promise.all([
      store.save("default", "welcome", "serial.note", encode("one")),
      store.save("default", "welcome", "serial.note", encode("two")),
    ]);
    const opened = await store.open("default", "welcome", "serial.note");
    expect(["one", "two"]).toContain(decode(opened?.bytes ?? new Uint8Array()));
    expect(await store.header("default", "welcome", "serial.note")).toMatchObject({
      payloadLength: 3,
    });
  });

  // spec: S6.4
  it("blocks a newer envelope with a sentence and an export path, and leaves the file alone", async () => {
    await store.create("default", "welcome", "future-envelope.note");
    await store.save(
      "default",
      "welcome",
      "future-envelope.note",
      encode("written by a newer Suite"),
    );

    const file = documentPath("default", "welcome", "future-envelope.note");
    const whole = new Uint8Array(await readFile(file));
    // A newer envelope is a bump of the two bytes after the magic.
    whole[DOCUMENT_MAGIC.length] = 0;
    whole[DOCUMENT_MAGIC.length + 1] = 2;
    await writeFile(file, whole);
    const refusal = await store
      .open("default", "welcome", "future-envelope.note")
      .catch((error) => error);
    expect(refusal).toBeInstanceOf(DocumentRefusal);
    expect((refusal as DocumentRefusal).kind).toBe("newer-envelope");
    expect((refusal as DocumentRefusal).message).toContain("envelope 2");
    expect((refusal as DocumentRefusal).message).toContain("Open it in a newer Suite");
    expect((refusal as DocumentRefusal).exportPath).toBe(
      "documents/default/welcome/future-envelope.note",
    );
    expect((refusal as DocumentRefusal).message).toContain(
      "documents/default/welcome/future-envelope.note",
    );

    // Refused, not repaired: nothing was created in its place and the bytes and
    // modification time are exactly what the newer writer left.
    expect(new Uint8Array(await readFile(file))).toEqual(whole);
    await expect(
      store.save("default", "welcome", "future-envelope.note", encode("old")),
    ).rejects.toBeInstanceOf(DocumentRefusal);
    expect(new Uint8Array(await readFile(file))).toEqual(whole);
  });

  // spec: S6.4
  it("blocks a newer schema with a sentence and an export path", async () => {
    const file = documentPath("default", "welcome", "future-schema.note");
    const payload = encode('{"from":"schema 2"}');
    await store.create("default", "welcome", "future-schema.note");
    // Written by a newer build: this store refuses to write schema 2 itself, so
    // the fixture is the published encoding with a raised schema.
    await writeFile(
      file,
      encodeDocumentEnvelope({
        publisher: "suite",
        packId: "welcome",
        documentId: "future-schema.note",
        schemaVersion: 2,
        payload,
      }),
    );
    const before = new Uint8Array(await readFile(file));

    const refusal = await store
      .open("default", "welcome", "future-schema.note")
      .catch((error) => error);
    expect(refusal).toBeInstanceOf(DocumentRefusal);
    expect((refusal as DocumentRefusal).kind).toBe("newer-schema");
    expect((refusal as DocumentRefusal).message).toContain("schema 2");
    expect((refusal as DocumentRefusal).message).toContain("understands up to 1");
    expect((refusal as DocumentRefusal).exportPath).toBe(
      "documents/default/welcome/future-schema.note",
    );
    expect(new Uint8Array(await readFile(file))).toEqual(before);

    // A caller that declares schema 2 reads it; the host does not decide the
    // pack's schema on its own.
    const opened = await store.open("default", "welcome", "future-schema.note", {
      schemaVersion: 2,
    });
    expect(opened?.bytes).toEqual(payload);
  });

  // spec: S6.4
  it("refuses a file from before the envelope without rewriting it", async () => {
    const directory = documentPath("default", "welcome");
    await store.create("default", "welcome", "placeholder.note");
    const file = join(directory, "legacy.note");
    await writeFile(file, encode("bare bytes from the old store"));
    const before = new Uint8Array(await readFile(file));

    const refusal = await store.open("default", "welcome", "legacy.note").catch((error) => error);
    expect(refusal).toBeInstanceOf(DocumentRefusal);
    expect((refusal as DocumentRefusal).kind).toBe("pre-envelope");
    expect((refusal as DocumentRefusal).message).toContain("before the host envelope");
    expect(new Uint8Array(await readFile(file))).toEqual(before);
    expect((await store.list("default", "welcome")).map((entry) => entry.name)).toContain(
      "legacy.note",
    );
  });

  // spec: S6.9
  it("rewrites the envelope without changing the payload bytes", async () => {
    const payload = encode('{"title":"kept","packOnly":{"nested":[1,2,3]}}');
    await store.create("default", "welcome", "preserve.note");
    await store.save("default", "welcome", "preserve.note", payload);
    const file = documentPath("default", "welcome", "preserve.note");
    const beforePayload = await payloadOnDisk(file, payload.byteLength);

    const rewritten = await store.rewrite("default", "welcome", "preserve.note", {
      schemaVersion: 1,
    });
    expect(rewritten.size).toBe(payload.byteLength);

    const afterPayload = await payloadOnDisk(file, payload.byteLength);
    expect(afterPayload).toEqual(beforePayload);
    expect(afterPayload).toEqual(payload);
    expect(await store.header("default", "welcome", "preserve.note")).toMatchObject({
      payloadChecksum: checksumOf(payload),
      payloadLength: payload.byteLength,
    });
    expect(
      decode((await store.open("default", "welcome", "preserve.note"))?.bytes ?? new Uint8Array()),
    ).toBe(decode(payload));
  });

  // spec: S6.9
  it("keeps unknown payload fields when the header is rewritten", async () => {
    const payload = encode('{"known":true,"fieldFromALaterPack":"survives"}');
    await store.create("default", "welcome", "unknown.note");
    await store.save("default", "welcome", "unknown.note", payload);
    await store.rewrite("default", "welcome", "unknown.note");

    const opened = await store.open("default", "welcome", "unknown.note");
    const parsed = JSON.parse(decode(opened?.bytes ?? new Uint8Array())) as Record<string, unknown>;
    expect(parsed).toEqual({ known: true, fieldFromALaterPack: "survives" });
  });
});
