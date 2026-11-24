import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  generatePackKeyPair,
  parsePackManifest,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { readPackArchive } from "@suite/pack-host";
import { bundlePack, publicKeyOfSigningKey } from "./pack.mjs";
import { checkEntry, manifestFor, requirePinnedSigningKey } from "./planner-pack.mjs";

const decoder = new TextDecoder();
const roots = [];

/** The directory Vite hands to `bundlePack`, byte for byte in miniature. */
function sourcePack() {
  const directory = mkdtempSync(join(tmpdir(), "suite-planner-pack-"));
  roots.push(directory);
  mkdirSync(join(directory, "assets"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify(
      {
        id: "planner",
        name: "Suite Planner",
        version: "0.5.1",
        entry: "index.html",
        contractVersion: 1,
        capabilities: ["documents", "files"],
        documents: [
          { id: "workspace", format: "suite.planner", version: 2, mode: "multi" },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(directory, "index.html"),
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';"><script type="module" crossorigin src="./assets/index-abc123.js"></script>',
  );
  writeFileSync(join(directory, "assets", "index-abc123.js"), "console.log('planner');");
  return directory;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("the signed Planner pack", () => {
  it("round-trips with an ephemeral key and carries the workspace declaration", async () => {
    const directory = sourcePack();
    const keys = await generatePackKeyPair();
    const outPath = join(directory, "planner.suitepack");

    const built = await bundlePack({
      directory,
      privateKeyBase64: keys.secretKeyBase64,
      expectedPublicKeyBase64: keys.publicKeyBase64,
      outPath,
    });

    assert.equal(built.manifest.id, "planner");
    assert.equal(built.manifest.contractVersion, 1);
    assert.deepEqual(built.manifest.capabilities, ["documents", "files"]);
    // The host stamps the schema this declaration names into the envelope, so the signed manifest
    // must carry it, not only the source manifest.
    assert.deepEqual(built.manifest.documents, [
      { id: "workspace", format: "suite.planner", version: 2, mode: "multi" },
    ]);
    assert.deepEqual(
      built.manifest.files.map((file) => file.path),
      ["assets/index-abc123.js", "index.html"],
    );

    const archive = await readPackArchive(new Uint8Array(readFileSync(outPath)));
    assert.equal(archive.files.has("manifest.json"), false);
    const parsed = parsePackManifest(JSON.parse(decoder.decode(archive.manifestBytes)));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(await verifyPackSignature(parsed.value, keys.publicKeyBase64), true);
      assert.deepEqual(parsed.value.documents, built.manifest.documents);
      assert.deepEqual(
        await verifyPackFiles(parsed.value, async (path) => archive.files.get(path) ?? null),
        [],
      );
    }
  });

  it("refuses a key whose public half is not the expected one", async () => {
    const directory = sourcePack();
    const signing = await generatePackKeyPair();
    const other = await generatePackKeyPair();

    await assert.rejects(
      bundlePack({
        directory,
        privateKeyBase64: signing.secretKeyBase64,
        expectedPublicKeyBase64: other.publicKeyBase64,
        outPath: join(directory, "refused.suitepack"),
      }),
      /does not match the expected public key/u,
    );
  });

  it("the production guard rejects a key that is not the pinned one", async () => {
    const signing = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    const publicHalf = publicKeyOfSigningKey(signing.secretKeyBase64);
    assert.equal(requirePinnedSigningKey(signing.secretKeyBase64, publicHalf), publicHalf);

    assert.throws(
      () => requirePinnedSigningKey(signing.secretKeyBase64, other.publicKeyBase64),
      /does not match SUITE_PACK_PUBLIC_KEY/u,
    );
    assert.throws(
      () => requirePinnedSigningKey(signing.secretKeyBase64, ""),
      /nothing to check the key against/u,
    );
  });
});

describe("the generated Planner entry", () => {
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
    const source = { id: "planner", version: "0.5.1" };
    assert.equal(manifestFor(source, "9.9.9").version, "9.9.9");
    assert.equal(source.version, "0.5.1");
  });
});
