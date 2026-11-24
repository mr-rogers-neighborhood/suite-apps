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
import { injectPrelude, manifestFor, requirePinnedSigningKey } from "./budget-pack.mjs";
import { bundlePack, publicKeyOfSigningKey } from "./pack.mjs";

const decoder = new TextDecoder();
const roots = [];

/** The directory Vite hands to `bundlePack`, byte for byte in miniature. */
function sourcePack() {
  const directory = mkdtempSync(join(tmpdir(), "suite-budget-pack-"));
  roots.push(directory);
  mkdirSync(join(directory, "assets"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify(
      {
        id: "budget",
        name: "Suite Budget",
        version: "0.1.0",
        entry: "index.html",
        contractVersion: 1,
        capabilities: ["documents", "files"],
        documents: [
          { id: "budget", format: "suite.budget.snapshot", version: 1, mode: "multi" },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(directory, "index.html"),
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';"><script type="module" src="./assets/index-abc123.js"></script>',
  );
  writeFileSync(join(directory, "prelude.js"), "console.log('prelude');");
  writeFileSync(join(directory, "assets", "index-abc123.js"), "console.log('budget');");
  return directory;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("the signed Budget pack", () => {
  it("round-trips with an ephemeral key and verifies against its public half", async () => {
    const directory = sourcePack();
    const keys = await generatePackKeyPair();
    const outPath = join(directory, "budget.suitepack");

    const built = await bundlePack({
      directory,
      privateKeyBase64: keys.secretKeyBase64,
      expectedPublicKeyBase64: keys.publicKeyBase64,
      outPath,
    });

    assert.equal(built.manifest.id, "budget");
    assert.equal(built.manifest.contractVersion, 1);
    assert.deepEqual(built.manifest.capabilities, ["documents", "files"]);
    // The host stamps the schema this declaration names into the envelope, so
    // the signed manifest must carry it, not only the source manifest.
    assert.deepEqual(built.manifest.documents, [
      { id: "budget", format: "suite.budget.snapshot", version: 1, mode: "multi" },
    ]);
    assert.equal(built.manifest.contributions, undefined);
    assert.deepEqual(
      built.manifest.files.map((file) => file.path),
      ["assets/index-abc123.js", "index.html", "prelude.js"],
    );

    const archive = await readPackArchive(new Uint8Array(readFileSync(outPath)));
    assert.equal(archive.files.has("manifest.json"), false);
    assert.equal(decoder.decode(archive.files.get("prelude.js")), "console.log('prelude');");

    const parsed = parsePackManifest(JSON.parse(decoder.decode(archive.manifestBytes)));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(await verifyPackSignature(parsed.value, keys.publicKeyBase64), true);
      assert.deepEqual(parsed.value.documents, built.manifest.documents);
      assert.deepEqual(
        await verifyPackFiles(
          parsed.value,
          async (path) => archive.files.get(path) ?? null,
        ),
        [],
      );
      // Another key is not this pack's publisher.
      const other = await generatePackKeyPair();
      assert.equal(await verifyPackSignature(parsed.value, other.publicKeyBase64), false);
    }
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
  });

  it("the production guard rejects a key that is not the pinned one", async () => {
    const signing = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    const publicHalf = publicKeyOfSigningKey(signing.secretKeyBase64);
    assert.equal(publicHalf, signing.publicKeyBase64);
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

describe("the generated entry page", () => {
  it("puts the prelude before the app script and keeps Vite's page", () => {
    const html = injectPrelude(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';"><link rel="stylesheet" href="./assets/index.css"><script type="module" crossorigin src="./assets/index-abc.js"></script>',
    );
    assert.ok(html.indexOf("./prelude.js") < html.indexOf("./assets/index-abc.js"));
    assert.match(html, /rel="stylesheet"/u);
    assert.equal(injectPrelude(html), html, "injection is idempotent");
  });

  it("refuses an entry with no module script or no pack CSP", () => {
    assert.throws(
      () =>
        injectPrelude(
          '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';"><p>empty</p>',
        ),
      /no module script/u,
    );
    assert.throws(
      () => injectPrelude('<script type="module" src="./app.js"></script>'),
      /no Content-Security-Policy/u,
    );
    assert.throws(
      () =>
        injectPrelude(
          '<meta http-equiv="Content-Security-Policy" content="default-src *"><script type="module" src="./app.js"></script>',
        ),
      /CSP must name/u,
    );
  });

  it("records the requested version without mutating the source", () => {
    const source = { id: "budget", version: "0.1.0" };
    assert.equal(manifestFor(source, "1.2.3").version, "1.2.3");
    assert.equal(source.version, "0.1.0");
  });
});
