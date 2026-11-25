import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  generatePackKeyPair,
  parsePackManifest,
  publisherKeyDigest,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { readPackArchive } from "@suite/pack-host";
import { bundlePack } from "./pack.mjs";

const decoder = new TextDecoder();

const roots = [];

/** A source pack: the development manifest and two payload files, one nested. */
function sourcePack() {
  const directory = mkdtempSync(join(tmpdir(), "suite-pack-"));
  roots.push(directory);
  mkdirSync(join(directory, "assets"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify(
      {
        id: "demo-pack",
        name: "Demo Pack",
        description: "Demo pack for the boundary tests.",
        version: "1.2.3",
        entry: "index.html",
        contractVersion: 1,
        capabilities: ["documents"],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(directory, "index.html"), "<!doctype html><title>Demo</title>");
  writeFileSync(join(directory, "assets", "app.js"), "console.log('demo');");
  return directory;
}

async function readArchive(path) {
  return readPackArchive(new Uint8Array(readFileSync(path)));
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("bundlePack", () => {
  it("builds a signed archive whose manifest names every payload file", async () => {
    const directory = sourcePack();
    const keys = await generatePackKeyPair();
    const outPath = join(directory, "demo-pack.suitepack");

    const built = await bundlePack({
      directory,
      privateKeyBase64: keys.secretKeyBase64,
      expectedPublicKeyBase64: keys.publicKeyBase64,
      outPath,
    });

    assert.equal(built.outPath, outPath);
    assert.equal(built.manifest.id, "demo-pack");
    assert.equal(built.manifest.version, "1.2.3");
    assert.equal(built.manifest.contractVersion, 1);
    assert.equal(built.manifest.description, "Demo pack for the boundary tests.");
    // The manifest names the publisher key the host verifies against its trust
    // store; here it is an ephemeral key, so the id is that key's digest.
    assert.deepEqual(built.manifest.publisher, {
      id: await publisherKeyDigest(keys.publicKeyBase64),
      key: keys.publicKeyBase64,
    });

    // The development manifest is the declaration, not a payload file.
    assert.deepEqual(
      built.manifest.files.map((file) => file.path),
      ["assets/app.js", "index.html"],
    );

    const archive = await readArchive(outPath);
    assert.equal(archive.files.has("manifest.json"), false);
    assert.deepEqual(
      [...archive.files.keys()].sort(),
      ["assets/app.js", "index.html"],
    );

    const parsed = parsePackManifest(JSON.parse(decoder.decode(archive.manifestBytes)));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.value.files, built.manifest.files);
    assert.equal(parsed.value.description, "Demo pack for the boundary tests.");

    assert.equal(await verifyPackSignature(parsed.value, keys.publicKeyBase64), true);
    const mismatches = await verifyPackFiles(
      parsed.value,
      async (path) => archive.files.get(path) ?? null,
    );
    assert.deepEqual(mismatches, []);

    const checksum = readFileSync(`${outPath}.sha256`, "utf8");
    assert.equal(checksum, `${built.sha256}  demo-pack.suitepack\n`);
    assert.equal(built.sha256, await shaOf(readFileSync(outPath)));
  });

  it("refuses a source manifest that names another publisher key", async () => {
    const directory = sourcePack();
    const keys = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        id: "demo-pack",
        name: "Demo Pack",
        version: "1.2.3",
        entry: "index.html",
        contractVersion: 1,
        capabilities: ["documents"],
        publisher: { id: "acme", key: other.publicKeyBase64 },
      }),
    );

    await assert.rejects(
      bundlePack({
        directory,
        privateKeyBase64: keys.secretKeyBase64,
        expectedPublicKeyBase64: keys.publicKeyBase64,
        outPath: join(directory, "refused.suitepack"),
      }),
      /publisher key that is not the signing key/u,
    );
  });

  it("refuses a key whose public half is not the expected one", async () => {
    const directory = sourcePack();
    const signing = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    const outPath = join(directory, "refused.suitepack");

    await assert.rejects(
      bundlePack({
        directory,
        privateKeyBase64: signing.secretKeyBase64,
        expectedPublicKeyBase64: other.publicKeyBase64,
        outPath,
      }),
      /does not match the expected public key/u,
    );
    assert.equal(existsSync(outPath), false);
  });

  it("keeps a file named __proto__ in the manifest and the archive", async () => {
    const directory = sourcePack();
    writeFileSync(join(directory, "__proto__"), "proto payload");
    const keys = await generatePackKeyPair();
    const outPath = join(directory, "proto.suitepack");

    const built = await bundlePack({
      directory,
      privateKeyBase64: keys.secretKeyBase64,
      expectedPublicKeyBase64: keys.publicKeyBase64,
      outPath,
    });

    const manifestPaths = built.manifest.files.map((file) => file.path);
    assert.deepEqual(manifestPaths, ["__proto__", "assets/app.js", "index.html"]);

    const archive = await readArchive(outPath);
    const archivePaths = [...archive.files.keys()];
    assert.deepEqual(archivePaths.filter((path) => path === "__proto__"), ["__proto__"]);
    assert.equal(decoder.decode(archive.files.get("__proto__")), "proto payload");
  });

  it("does not hash a previous build written inside the source directory", async () => {
    const directory = sourcePack();
    const keys = await generatePackKeyPair();
    const outPath = join(directory, "demo-pack.suitepack");

    const first = await bundlePack({
      directory,
      privateKeyBase64: keys.secretKeyBase64,
      expectedPublicKeyBase64: keys.publicKeyBase64,
      outPath,
    });
    const second = await bundlePack({
      directory,
      privateKeyBase64: keys.secretKeyBase64,
      expectedPublicKeyBase64: keys.publicKeyBase64,
      outPath,
    });

    // The archive and its .sha256 are build output, not payload. A second run
    // must produce the same manifest, not one that hashes the first run.
    assert.deepEqual(
      second.manifest.files.map((file) => file.path),
      ["assets/app.js", "index.html"],
    );
    assert.deepEqual(second.manifest.files, first.manifest.files);
    const archive = await readArchive(outPath);
    assert.deepEqual([...archive.files.keys()].sort(), ["assets/app.js", "index.html"]);
  });
});

describe("the pack pin", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const pinFile = "packages/pack/src/pinnedKey.ts";

  it("has one source, which the phone imports rather than repeats", () => {
    const pinSource = readFileSync(join(root, pinFile), "utf8");
    const match = /SUITE_PACK_PUBLIC_KEY\s*=\s*"([^"]+)"/u.exec(pinSource);
    assert.ok(match, `${pinFile} does not declare SUITE_PACK_PUBLIC_KEY`);
    const pinned = match[1];

    const goSource = readFileSync(join(root, "hosts/go/src/host/packs.ts"), "utf8");
    assert.match(goSource, /from "@suite\/pack\/pinned-key"/u);
    assert.match(goSource, /SUITE_PACK_PUBLIC_KEY/u);
    assert.equal(
      goSource.includes(pinned),
      false,
      "hosts/go/src/host/packs.ts repeats the pinned key instead of importing it",
    );

    // The key tooling must read that same constant, or `pnpm keys status` would check another pin.
    const librarySource = readFileSync(join(root, "scripts/lib/keys.mjs"), "utf8");
    assert.match(librarySource, /pinFile: "packages\/pack\/src\/pinnedKey\.ts"/u);
    assert.match(librarySource, /pinName: "SUITE_PACK_PUBLIC_KEY"/u);
  });
});

/** The digest rule the archive checksum promises, independent of the code that wrote it. */
async function shaOf(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
