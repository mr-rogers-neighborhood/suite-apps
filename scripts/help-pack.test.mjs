import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import {
  generatePackKeyPair,
  parsePackManifest,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { readPackArchive } from "@suite/pack-host";
import { checkEntry, checkPayload, comparePayloads, manifestFor } from "./help-pack.mjs";
import { bundlePack } from "./pack.mjs";

const encoder = new TextEncoder();
const roots = [];

/** The smallest payload that has the corpus the build must keep. */
function payload(overrides = {}) {
  return {
    "index.html": encoder.encode("<!doctype html>"),
    "data/tree.json": encoder.encode("{}"),
    "data/modules.json": encoder.encode("[]"),
    "data/search.json": encoder.encode("[]"),
    "data/tours.json": encoder.encode("[]"),
    "data/tour-membership.json": encoder.encode("{}"),
    "data/handbook-search.json": encoder.encode("[]"),
    "data/docs.json": encoder.encode('{"version":1,"pages":[]}'),
    "data/modules/apps__help.json": encoder.encode("{}"),
    "assets/index-abc.js": encoder.encode("export {};"),
    ...overrides,
  };
}

after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the bundled corpus", () => {
  it("accepts the index files, a module file and a compiled asset", () => {
    assert.doesNotThrow(() => checkPayload(payload()));
  });

  it("names a missing index file, an empty Modules view or lost pages", () => {
    assert.throws(
      () => checkPayload(payload({ "data/tree.json": undefined })),
      /missing data\/tree\.json/u,
    );
    assert.throws(
      () => checkPayload(payload({ "data/modules/apps__help.json": undefined })),
      /no per-module data files/u,
    );
    assert.throws(
      () => checkPayload(payload({ "assets/index-abc.js": undefined })),
      /no compiled assets/u,
    );
  });
});

describe("the signed Help pack", () => {
  it("carries the corpus hashes and declares no host capability", async () => {
    const directory = mkdtempSync(join(tmpdir(), "suite-help-pack-"));
    roots.push(directory);
    const files = payload();
    for (const [path, bytes] of Object.entries(files)) {
      const target = join(directory, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        id: "help",
        name: "Suite Help",
        version: "0.1.2",
        entry: "index.html",
        contractVersion: 1,
        capabilities: [],
      }),
    );

    const keys = await generatePackKeyPair();
    const outPath = join(directory, "help.suitepack");
    const built = await bundlePack({
      directory,
      privateKeyBase64: keys.secretKeyBase64,
      expectedPublicKeyBase64: keys.publicKeyBase64,
      outPath,
    });

    assert.deepEqual(built.manifest.capabilities, []);
    assert.deepEqual(
      built.manifest.files.map((file) => file.path),
      Object.keys(files).sort(),
    );

    const archive = await readPackArchive(new Uint8Array(readFileSync(outPath)));
    assert.equal(archive.files.has("manifest.json"), false);
    const parsed = parsePackManifest(JSON.parse(new TextDecoder().decode(archive.manifestBytes)));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(await verifyPackSignature(parsed.value, keys.publicKeyBase64), true);
      assert.deepEqual(
        await verifyPackFiles(parsed.value, async (path) => archive.files.get(path) ?? null),
        [],
      );
    }
  });
});


describe("the generated Help entry", () => {
  it("accepts a built page with a sealed policy and a module entry", () => {
    assert.doesNotThrow(() =>
      checkEntry(
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';"><script type="module" crossorigin src="./assets/index-abc.js"></script>',
      ),
    );
  });

  it("refuses a page that lost its policy or its module script", () => {
    assert.throws(
      () => checkEntry('<script type="module" src="./app.js"></script>'),
      /no Content-Security-Policy/u,
    );
    assert.throws(
      () =>
        checkEntry(
          '<meta http-equiv="Content-Security-Policy" content="default-src *"><script type="module" src="./app.js"></script>',
        ),
      /CSP must name/u,
    );
    assert.throws(
      () =>
        checkEntry(
          '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';"><p>empty</p>',
        ),
      /no module script/u,
    );
  });

  it("records the requested version without mutating the source", () => {
    const source = { id: "help", version: "0.1.2" };
    assert.equal(manifestFor(source, "9.9.9").version, "9.9.9");
    assert.equal(source.version, "0.1.2");
  });
});

describe("the two-build comparison", () => {
  const file = (path, sha256, bytes = 1) => ({ path, sha256, bytes });

  it("ignores order and accepts identical hashes", () => {
    const first = [file("a.js", "a".repeat(64)), file("index.html", "b".repeat(64), 2)];
    const second = [file("index.html", "b".repeat(64), 2), file("a.js", "a".repeat(64))];
    assert.deepEqual(comparePayloads(first, second), {
      same: true,
      onlyLeft: [],
      onlyRight: [],
      differing: [],
    });
  });

  it("names a path only one build wrote and a hash that moved", () => {
    const first = [file("a.js", "a".repeat(64)), file("index.html", "b".repeat(64), 2)];
    const second = [file("a.js", "c".repeat(64)), file("style.css", "d".repeat(64), 3)];
    const result = comparePayloads(first, second);
    assert.equal(result.same, false);
    assert.deepEqual(result.onlyLeft, ["index.html"]);
    assert.deepEqual(result.onlyRight, ["style.css"]);
    assert.deepEqual(result.differing, ["a.js"]);
  });
});
