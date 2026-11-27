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
import { CARD_FORMAT, CARD_VERSION, PACK_CARD_META } from "./lib/packCard.mjs";

const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "suite-release-index-"));
  roots.push(root);
  return root;
}

/** One signed .suitepack and card fixture, plus a build command that copies them into place. */
async function fixturePack(
  root,
  {
    id = "demo",
    name = "Demo",
    version = "0.1.0",
    description = "A pack for the release-index test.",
    capabilities = ["documents"],
    platforms = ["desktop"],
    shelf = 1,
  } = {},
) {
  const source = join(root, `${id}-source`);
  mkdirSync(join(source, "assets"), { recursive: true });
  writeFileSync(
    join(source, "manifest.json"),
    JSON.stringify({
      id,
      name,
      version,
      description,
      entry: "index.html",
      contractVersion: 1,
      capabilities,
      platforms,
    }),
  );
  writeFileSync(join(source, "index.html"), `<!doctype html><title>${name}</title>`);
  writeFileSync(join(source, "assets", "app.js"), `console.log(${JSON.stringify(id)});`);

  const keys = await generatePackKeyPair();
  const archive = join(root, `${id}-${version}.suitepack`);
  const card = join(root, `${id}-${version}.card.json`);
  await bundlePack({
    directory: source,
    privateKeyBase64: keys.secretKeyBase64,
    expectedPublicKeyBase64: keys.publicKeyBase64,
    outPath: archive,
  });
  writeFileSync(
    card,
    `${JSON.stringify(
      {
        format: CARD_FORMAT,
        version: CARD_VERSION,
        id,
        packVersion: version,
        name,
        description,
        shelf,
        icon: PACK_CARD_META.canvas.icon,
      },
      null,
      2,
    )}\n`,
  );

  const packsDir = join(root, "packs");
  const staged = join(packsDir, `${id}-${version}.suitepack`);
  const stagedCard = join(packsDir, `${id}-${version}.card.json`);
  const builder = join(root, `stage-${id}.mjs`);
  writeFileSync(
    builder,
    `import { mkdirSync, copyFileSync } from "node:fs";\n` +
      `mkdirSync(${JSON.stringify(packsDir)}, { recursive: true });\n` +
      `copyFileSync(${JSON.stringify(archive)}, ${JSON.stringify(staged)});\n` +
      `copyFileSync(${JSON.stringify(card)}, ${JSON.stringify(stagedCard)});\n`,
  );
  return {
    archive,
    card,
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
      staged.index.entries[0]?.archive.url,
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
    assert.deepEqual(metadata.cards, ["demo-0.1.0.card.json"]);
    assert.deepEqual(staged.cards, [join(fixture.packsDir, "demo-0.1.0.card.json")]);

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
  it("stages all four mobile packs with cards and keeps the strict index parseable", async () => {
    const root = workspace();
    const packs = [
      {
        id: "canvas",
        name: "Suite Canvas",
        version: "0.1.13",
        description: "A local-first canvas of boards, cards and links.",
        capabilities: ["documents", "files", "recents"],
        shelf: 1,
      },
      {
        id: "planner",
        name: "Suite Planner",
        version: "0.5.2",
        description: "A local-first day plan in one file.",
        capabilities: ["documents", "files", "notifications"],
        shelf: 2,
      },
      {
        id: "budget",
        name: "Suite Budget",
        version: "0.4.2",
        description: "A local-first envelope budget.",
        capabilities: ["documents", "files"],
        shelf: 3,
      },
      {
        id: "help",
        name: "Suite Help",
        version: "0.1.3",
        description: "The repository handbook and code explorer, offline in one pack.",
        capabilities: [],
        shelf: 4,
      },
    ];
    const fixtures = [];
    for (const pack of packs) {
      fixtures.push(
        await fixturePack(root, {
          ...pack,
          platforms: ["desktop", "mobile"],
        }),
      );
    }

    const operator = await generatePackKeyPair();
    const outDir = join(root, "four");
    const staged = await prepareIndex({
      builds: fixtures.map((fixture) => fixture.build),
      packsDir: fixtures[0].packsDir,
      outDir,
      privateKey: operator.secretKeyBase64,
      expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
      now: GENERATED_AT,
      log: () => {},
    });

    assert.equal(staged.index.entries.length, 4);
    assert.deepEqual(
      staged.index.entries.map((entry) => entry.id),
      ["budget", "canvas", "help", "planner"],
    );
    assert.equal(staged.cards.length, 4);
    for (const entry of staged.index.entries) {
      assert.deepEqual(entry.platforms, ["desktop", "mobile"]);
      // The signed entry schema is strict: a card must never appear here.
      assert.deepEqual(Object.keys(entry).sort(), [
        "archive",
        "capabilities",
        "contractVersion",
        "description",
        "id",
        "name",
        "platforms",
        "publisher",
        "ring",
        "signature",
        "version",
      ]);
    }

    // The same parser a current stable host ships still reads the index.
    const parsed = parsePackIndexJson(readFileSync(join(outDir, "index.json"), "utf8"));
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value.entries.length, 4);
  });

  // spec: S12.2
  it("publishes the staged index, signature, archives and cards to the same bucket", async () => {
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

    // Order is a contract, not list position: archives, then their cards, then
    // the signature, then the index last. A consumer must never fetch an index
    // that names an archive or card not yet stored.
    const uploadTargets = calls
      .filter((call) => call[1] === "s3" && call[2] === "cp")
      .map((call) => call[4]);
    assert.deepEqual(uploadTargets, [
      "s3://suite-store/packs/demo-0.1.0.suitepack",
      "s3://suite-store/packs/demo-0.1.0.card.json",
      "s3://suite-store/index.json.sig",
      "s3://suite-store/index.json",
    ]);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ["aws", "cloudfront"]);

    const text = calls.map((call) => call.join(" ")).join("\n");
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

  // spec: S12.2 — a version names its bytes; the archive URL is cached immutably.
  it("refuses to republish a version with different bytes", async () => {
    const root = workspace();
    const operator = await generatePackKeyPair();
    const outDir = join(root, "out");
    const first = await fixturePack(root, { description: "The first build." });
    await prepareIndex({
      builds: [first.build],
      packsDir: first.packsDir,
      outDir,
      privateKey: operator.secretKeyBase64,
      expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
      now: GENERATED_AT,
      log: () => {},
    });

    // Same id and version, different manifest, so the archive digest changes.
    const secondRoot = workspace();
    const changed = await fixturePack(secondRoot, { description: "Changed without a bump." });
    await assert.rejects(
      prepareIndex({
        builds: [changed.build],
        packsDir: changed.packsDir,
        outDir: join(root, "next"),
        privateKey: operator.secretKeyBase64,
        expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
        priorIndex: readFileSync(join(outDir, "index.json"), "utf8"),
        now: new Date("2026-06-02T00:00:00.000Z"),
        log: () => {},
      }),
      /bump the pack version/u,
    );
  });

  // spec: S12.2
  it("refuses to publish a pack version below the one already published", async () => {
    const root = workspace();
    const operator = await generatePackKeyPair();
    const outDir = join(root, "out");
    const first = await fixturePack(root, { version: "0.2.0" });
    await prepareIndex({
      builds: [first.build],
      packsDir: first.packsDir,
      outDir,
      privateKey: operator.secretKeyBase64,
      expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
      now: GENERATED_AT,
      log: () => {},
    });

    const older = await fixturePack(workspace(), { version: "0.1.0" });
    await assert.rejects(
      prepareIndex({
        builds: [older.build],
        packsDir: older.packsDir,
        outDir: join(root, "next"),
        privateKey: operator.secretKeyBase64,
        expectedFingerprint: await publisherKeyFingerprint(operator.publicKeyBase64),
        priorIndex: readFileSync(join(outDir, "index.json"), "utf8"),
        now: new Date("2026-06-02T00:00:00.000Z"),
        log: () => {},
      }),
      /never moves a pack backwards/u,
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
