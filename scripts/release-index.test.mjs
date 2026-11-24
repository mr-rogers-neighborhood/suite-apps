import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  generatePackKeyPair,
  packIndexDigest,
  parsePackIndexJson,
  publisherKeyFingerprint,
  verifyBytes,
  verifyPackIndex,
} from "@suite/pack";
import {
  NO_PACKS_MESSAGE,
  prepareIndex,
  publishPrepared,
} from "./release-index.mjs";
import { bundlePack } from "./pack.mjs";

const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "suite-release-index-"));
  roots.push(root);
  return root;
}

/** One signed .suitepack fixture, plus a build command that copies it into place. */
async function fixturePack(root) {
  const source = join(root, "source");
  mkdirSync(join(source, "assets"), { recursive: true });
  writeFileSync(
    join(source, "manifest.json"),
    JSON.stringify({
      id: "demo",
      name: "Demo",
      version: "0.1.0",
      description: "A pack for the release-index test.",
      entry: "index.html",
      contractVersion: 1,
      capabilities: ["documents"],
    }),
  );
  writeFileSync(join(source, "index.html"), "<!doctype html><title>Demo</title>");
  writeFileSync(join(source, "assets", "app.js"), "console.log('demo');");

  const keys = await generatePackKeyPair();
  const archive = join(root, "demo-0.1.0.suitepack");
  await bundlePack({
    directory: source,
    privateKeyBase64: keys.secretKeyBase64,
    expectedPublicKeyBase64: keys.publicKeyBase64,
    outPath: archive,
  });

  const packsDir = join(root, "packs");
  const staged = join(packsDir, "demo-0.1.0.suitepack");
  const builder = join(root, "stage-pack.mjs");
  writeFileSync(
    builder,
    `import { mkdirSync, copyFileSync } from "node:fs";\n` +
      `mkdirSync(${JSON.stringify(packsDir)}, { recursive: true });\n` +
      `copyFileSync(${JSON.stringify(archive)}, ${JSON.stringify(staged)});\n`,
  );
  return {
    archive,
    packsDir,
    build: `${process.execPath} ${builder}`,
    keys,
  };
}

const GENERATED_AT = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-01-15T00:00:00.000Z");

describe("release catalogue index", () => {
  // spec: S12.2
  it("stages an index from the built archive and verifies against the operator key", async () => {
    const root = workspace();
    const fixture = await fixturePack(root);
    const operator = await generatePackKeyPair();
    const outDir = join(root, "out");

    const staged = await prepareIndex({
      builds: [fixture.build],
      packsDir: fixture.packsDir,
      outDir,
      privateKey: operator.secretKeyBase64,
      expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
      now: GENERATED_AT,
      log: () => {},
    });

    assert.equal(staged.prepared, true);
    assert.equal(staged.index.sequence, 1);
    assert.equal(staged.index.entries.length, 1);
    assert.match(staged.index.expires, /^2026-01-31T00:00:00\.000Z$/u);
    assert.equal(staged.index.entries[0]?.id, "demo");
    assert.equal(
      staged.index.entries[0]?.url,
      "https://flatpak.suite.run/packs/demo-0.1.0.suitepack",
    );

    const text = readFileSync(join(outDir, "index.json"), "utf8");
    const parsed = parsePackIndexJson(text);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const verified = await verifyPackIndex(parsed.value, {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
    });
    assert.equal(verified.ok, true);

    // The detached signature covers the exact file bytes, not the canonical form.
    const signature = readFileSync(join(outDir, "index.json.sig"), "utf8").trim();
    assert.equal(
      verifyBytes(new TextEncoder().encode(text), signature, operator.publicKeyBase64),
      true,
    );

    const metadata = JSON.parse(readFileSync(join(outDir, "index-release.json"), "utf8"));
    assert.equal(metadata.sequence, 1);
    assert.equal(metadata.fingerprint, await publisherKeyFingerprint(operator.publicKeyBase64));
    assert.equal(metadata.url, "https://flatpak.suite.run/index.json");
    assert.equal(metadata.signatureUrl, "https://flatpak.suite.run/index.json.sig");

    // A second publication chains from the first.
    const next = await prepareIndex({
      builds: [fixture.build],
      packsDir: fixture.packsDir,
      outDir,
      privateKey: operator.secretKeyBase64,
      expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
      priorIndex: text,
      now: new Date("2026-06-02T00:00:00.000Z"),
      log: () => {},
    });
    assert.equal(next.prepared, true);
    assert.equal(next.index.sequence, 2);
    assert.equal(next.index.previous, await packIndexDigest(parsed.value));
  });

  // spec: S12.2
  it("publishes the staged index, signature and archives to the same bucket", async () => {
    const root = workspace();
    const fixture = await fixturePack(root);
    const operator = await generatePackKeyPair();
    const outDir = join(root, "out");
    await prepareIndex({
      builds: [fixture.build],
      packsDir: fixture.packsDir,
      outDir,
      privateKey: operator.secretKeyBase64,
      expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
      now: GENERATED_AT,
      log: () => {},
    });

    const calls = [];
    const published = publishPrepared({
      outDir,
      bucket: "suite-store",
      distribution: "DISTRIBUTION",
      run: (command, args) => calls.push([command, ...args]),
      log: () => {},
    });

    assert.equal(published.published, true);
    const text = calls.map((call) => call.join(" ")).join("\n");
    assert.match(text, /s3 cp .*index\.json s3:\/\/suite-store\/index\.json/u);
    assert.match(text, /s3 cp .*index\.json\.sig s3:\/\/suite-store\/index\.json\.sig/u);
    assert.match(
      text,
      /s3 cp .*demo-0\.1\.0\.suitepack s3:\/\/suite-store\/packs\/demo-0\.1\.0\.suitepack/u,
    );
    assert.match(text, /cloudfront create-invalidation --distribution-id DISTRIBUTION/u);
    assert.match(text, /\/index\.json/u);
    assert.match(text, /\/index\.json\.sig/u);
  });
});

describe("release catalogue index refusals", () => {
  // spec: S12.2
  it("prints the skip sentence and stages nothing when no pack is built", async () => {
    const root = workspace();
    const outDir = join(root, "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "index.json"), "stale");

    const messages = [];
    const result = await prepareIndex({
      builds: [],
      outDir,
      log: (line) => messages.push(line),
    });

    assert.deepEqual(result, { prepared: false, reason: NO_PACKS_MESSAGE });
    assert.deepEqual(messages, [`${NO_PACKS_MESSAGE}\n`]);
    // A stale local index must not survive a release that publishes none.
    assert.equal(existsSync(join(outDir, "index.json")), false);
    // A publish with no staged index says the same thing rather than uploading.
    const published = publishPrepared({
      outDir: join(root, "empty"),
      bucket: "suite-store",
      distribution: "DISTRIBUTION",
      run: () => assert.fail("nothing should be uploaded"),
      log: () => {},
    });
    assert.equal(published.published, false);
    assert.equal(published.reason, NO_PACKS_MESSAGE);
  });

  // spec: S12.2
  it("fails loudly when the operator key is missing", async () => {
    const root = workspace();
    const fixture = await fixturePack(root);
    await assert.rejects(
      prepareIndex({
        builds: [fixture.build],
        packsDir: fixture.packsDir,
        outDir: join(root, "out"),
        expectedFingerprint: "AA:".repeat(31) + "AA",
        log: () => {},
      }),
      /SUITE_INDEX_KEY/u,
    );
  });

  // spec: S12.2
  it("fails loudly when the fingerprint does not match the pinned value", async () => {
    const root = workspace();
    const fixture = await fixturePack(root);
    const operator = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    await assert.rejects(
      prepareIndex({
        builds: [fixture.build],
        packsDir: fixture.packsDir,
        outDir: join(root, "out"),
        privateKey: operator.secretKeyBase64,
        expectedFingerprint: await publisherKeyFingerprint(other.publicKeyBase64),
        log: () => {},
      }),
      /does not match the pinned/u,
    );
  });

  // spec: S12.2
  it("refuses a published index signed by another operator", async () => {
    const root = workspace();
    const fixture = await fixturePack(root);
    const first = await generatePackKeyPair();
    const other = await generatePackKeyPair();
    const outDir = join(root, "out");
    const staged = await prepareIndex({
      builds: [fixture.build],
      packsDir: fixture.packsDir,
      outDir,
      privateKey: first.secretKeyBase64,
      expectedFingerprint: await publisherKeyFingerprint(first.publicKeyBase64),
      now: GENERATED_AT,
      log: () => {},
    });
    assert.equal(staged.prepared, true);

    await assert.rejects(
      prepareIndex({
        builds: [fixture.build],
        packsDir: fixture.packsDir,
        outDir: join(root, "next"),
        privateKey: other.secretKeyBase64,
        expectedFingerprint: await publisherKeyFingerprint(other.publicKeyBase64),
        priorIndex: readFileSync(join(outDir, "index.json"), "utf8"),
        now: new Date("2026-06-02T00:00:00.000Z"),
        log: () => {},
      }),
      /published index does not verify/u,
    );
  });

  // spec: S12.2
  it("refuses a build list that produced no archive", async () => {
    const root = workspace();
    const operator = await generatePackKeyPair();
    await assert.rejects(
      prepareIndex({
        builds: ["true"],
        packsDir: join(root, "packs"),
        outDir: join(root, "out"),
        privateKey: operator.secretKeyBase64,
        expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
        log: () => {},
      }),
      /produced no \.suitepack/u,
    );
  });
});
