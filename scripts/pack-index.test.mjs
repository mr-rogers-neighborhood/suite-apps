import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  generatePackKeyPair,
  packIndexDigest,
  sha256Hex,
  verifyPackIndexJson,
} from "@suite/pack";
import { buildPackIndex, main } from "./pack-index.mjs";
import { bundlePack } from "./pack.mjs";

const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "suite-pack-index-"));
  roots.push(root);
  return root;
}

/** Build one signed pack and return its archive path. */
async function buildPack(root, { id, name, version, description, capabilities }) {
  const directory = join(root, `${id}-${version}`);
  mkdirSync(join(directory, "assets"), { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id,
      name,
      version,
      description,
      entry: "index.html",
      contractVersion: 1,
      capabilities,
    }),
  );
  writeFileSync(join(directory, "index.html"), `<!doctype html><title>${name}</title>`);
  writeFileSync(join(directory, "assets", "app.js"), `console.log(${JSON.stringify(id)});`);
  const keys = await generatePackKeyPair();
  const outPath = join(root, `${id}-${version}.suitepack`);
  await bundlePack({
    directory,
    privateKeyBase64: keys.secretKeyBase64,
    expectedPublicKeyBase64: keys.publicKeyBase64,
    outPath,
  });
  return outPath;
}

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const EXPIRES = "2027-01-01T00:00:00.000Z";
const NOW = new Date("2026-06-01T00:00:00.000Z");

describe("pack-index build", () => {
  // spec: S12.2
  it("builds an operator-signed index from built archives and it verifies", async () => {
    const root = workspace();
    const canvas = await buildPack(root, {
      id: "canvas",
      name: "Canvas",
      version: "0.2.0",
      description: "A whiteboard for the Suite.",
      capabilities: ["files", "relay"],
    });
    const notes = await buildPack(root, {
      id: "notes",
      name: "Notes",
      version: "1.0.0",
      capabilities: ["documents"],
    });
    const operator = await generatePackKeyPair();
    const outPath = join(root, "index.json");

    const built = await buildPackIndex({
      archives: [notes, canvas],
      urlBase: "https://packs.suite.run/",
      sequence: 1,
      generatedAt: GENERATED_AT,
      expires: EXPIRES,
      privateKeys: [operator.secretKeyBase64],
      outPath,
    });

    assert.equal(built.index.entries.length, 2);
    assert.deepEqual(
      built.index.entries.map((entry) => entry.id),
      ["canvas", "notes"],
    );
    const canvasEntry = built.index.entries[0];
    assert.equal(canvasEntry.name, "Canvas");
    // An ephemeral pack key has no id of its own, so its digest names the publisher.
    assert.match(canvasEntry.publisher, /^[a-f0-9]{64}$/u);
    assert.equal(canvasEntry.version, "0.2.0");
    assert.equal(canvasEntry.description, "A whiteboard for the Suite.");
    assert.deepEqual(canvasEntry.capabilities, ["files", "relay"]);
    assert.deepEqual(canvasEntry.platforms, ["desktop"]);
    assert.equal(canvasEntry.url, "https://packs.suite.run/canvas-0.2.0.suitepack");
    const canvasBytes = readFileSync(canvas);
    assert.equal(canvasEntry.size, statSync(canvas).size);
    assert.equal(canvasEntry.sha256, await sha256Hex(canvasBytes));

    const verified = await verifyPackIndexJson(readFileSync(outPath, "utf8"), {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
    });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.digest, built.digest);
  });

  // spec: S12.2
  it("requires the threshold of operator keys and chains the next sequence", async () => {
    const root = workspace();
    const canvas = await buildPack(root, {
      id: "canvas",
      name: "Canvas",
      version: "0.2.0",
      capabilities: ["files"],
    });
    const first = await generatePackKeyPair();
    const second = await generatePackKeyPair();
    const firstIndex = await buildPackIndex({
      archives: [canvas],
      urlBase: "https://packs.suite.run/",
      sequence: 1,
      generatedAt: GENERATED_AT,
      expires: EXPIRES,
      threshold: 2,
      privateKeys: [first.secretKeyBase64, second.secretKeyBase64],
    });
    assert.equal(firstIndex.index.signatures.length, 2);

    const next = await buildPackIndex({
      archives: [canvas],
      urlBase: "https://packs.suite.run/",
      sequence: 2,
      generatedAt: "2026-02-01T00:00:00.000Z",
      expires: EXPIRES,
      previous: firstIndex.digest,
      threshold: 2,
      privateKeys: [first.secretKeyBase64, second.secretKeyBase64],
    });

    const advanced = await verifyPackIndexJson(next.json, {
      operatorKeys: [first.publicKeyBase64, second.publicKeyBase64],
      now: NOW,
      head: { sequence: 1, digest: firstIndex.digest },
    });
    assert.equal(advanced.ok, true);

    const rolledBack = await verifyPackIndexJson(firstIndex.json, {
      operatorKeys: [first.publicKeyBase64, second.publicKeyBase64],
      now: NOW,
      head: { sequence: 1, digest: firstIndex.digest },
    });
    assert.equal(rolledBack.ok, false);
    assert.equal(rolledBack.reason, "rollback");
  });

  // spec: S12.2
  it("refuses a second index that does not name its predecessor", async () => {
    const root = workspace();
    const canvas = await buildPack(root, {
      id: "canvas",
      name: "Canvas",
      version: "0.2.0",
      capabilities: ["files"],
    });
    const operator = await generatePackKeyPair();

    await assert.rejects(
      buildPackIndex({
        archives: [canvas],
        urlBase: "https://packs.suite.run/",
        sequence: 2,
        generatedAt: GENERATED_AT,
        expires: EXPIRES,
        privateKeys: [operator.secretKeyBase64],
      }),
      /previous/u,
    );
  });

  // spec: S12.2
  it("refuses the same pack twice and a file that is not an archive", async () => {
    const root = workspace();
    const canvas = await buildPack(root, {
      id: "canvas",
      name: "Canvas",
      version: "0.2.0",
      capabilities: ["files"],
    });
    const operator = await generatePackKeyPair();

    await assert.rejects(
      buildPackIndex({
        archives: [canvas, canvas],
        urlBase: "https://packs.suite.run/",
        sequence: 1,
        generatedAt: GENERATED_AT,
        expires: EXPIRES,
        privateKeys: [operator.secretKeyBase64],
      }),
      /duplicate entry canvas@0\.2\.0/u,
    );

    const notAnArchive = join(root, "not-a-pack.suitepack");
    writeFileSync(notAnArchive, "this is not a zip");
    await assert.rejects(
      buildPackIndex({
        archives: [notAnArchive],
        urlBase: "https://packs.suite.run/",
        sequence: 1,
        generatedAt: GENERATED_AT,
        expires: EXPIRES,
        privateKeys: [operator.secretKeyBase64],
      }),
    );
  });

  // spec: S12.2
  it("writes the index from the command line", async () => {
    const root = workspace();
    const canvas = await buildPack(root, {
      id: "canvas",
      name: "Canvas",
      version: "0.2.0",
      capabilities: ["files"],
    });
    const operator = await generatePackKeyPair();
    const outPath = join(root, "cli-index.json");
    const written = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    let code;
    try {
      code = await main([
        "--out",
        outPath,
        "--url-base",
        "https://packs.suite.run/",
        "--sequence",
        "1",
        "--expires",
        EXPIRES,
        "--generated-at",
        GENERATED_AT,
        "--key",
        operator.secretKeyBase64,
        canvas,
      ]);
    } finally {
      process.stdout.write = original;
    }

    assert.equal(code, 0);
    assert.match(written.join(""), /sequence 1/u);
    assert.match(written.join(""), /digest [a-f0-9]{64}/u);
    const verified = await verifyPackIndexJson(readFileSync(outPath, "utf8"), {
      operatorKeys: [operator.publicKeyBase64],
      now: NOW,
    });
    assert.equal(verified.ok, true);
    assert.equal(await packIndexDigest(verified.index), verified.digest);
  });
});
