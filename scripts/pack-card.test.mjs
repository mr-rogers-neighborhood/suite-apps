import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  CARD_FORMAT,
  CARD_SUFFIX,
  CARD_VERSION,
  MAX_CARD_BYTES,
  PACK_CARD_META,
  cardFileNameFor,
  cardPathForArchive,
  cardUrlForArchiveUrl,
  parsePackCard,
  writePackCard,
} from "./lib/packCard.mjs";

const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "suite-pack-card-"));
  roots.push(root);
  return root;
}

const manifest = {
  id: "canvas",
  name: "Suite Canvas",
  description: "A local-first canvas of boards, cards and links.",
  version: "0.1.13",
};

function card(overrides = {}) {
  return {
    format: CARD_FORMAT,
    version: CARD_VERSION,
    id: manifest.id,
    packVersion: manifest.version,
    name: manifest.name,
    description: manifest.description,
    shelf: 1,
    icon: PACK_CARD_META.canvas.icon,
    ...overrides,
  };
}

describe("the pack card sidecar", () => {
  it("names the card beside the archive and derives its URL from the archive URL", () => {
    assert.equal(cardFileNameFor("canvas-0.1.13.suitepack"), `canvas-0.1.13${CARD_SUFFIX}`);
    assert.equal(
      cardPathForArchive("/tmp/packs/canvas-0.1.13.suitepack"),
      `/tmp/packs/canvas-0.1.13${CARD_SUFFIX}`,
    );
    assert.equal(
      cardUrlForArchiveUrl("https://flatpak.suite.run/packs/canvas-0.1.13.suitepack"),
      `https://flatpak.suite.run/packs/canvas-0.1.13${CARD_SUFFIX}`,
    );
    // A query survives; a fragment never reaches a server and is dropped.
    assert.equal(
      cardUrlForArchiveUrl("https://flatpak.suite.run/packs/canvas-0.1.13.suitepack?v=1#x"),
      `https://flatpak.suite.run/packs/canvas-0.1.13${CARD_SUFFIX}?v=1`,
    );
    assert.throws(() => cardFileNameFor("canvas.zip"), /\.suitepack/u);
    assert.throws(() => cardUrlForArchiveUrl("https://flatpak.suite.run/packs/canvas.zip"), /\.suitepack/u);
  });

  it("writes a readable card beside the archive", () => {
    const root = workspace();
    const archivePath = join(root, "canvas-0.1.13.suitepack");
    const written = writePackCard({ archivePath, manifest });

    assert.equal(written.path, join(root, `canvas-0.1.13${CARD_SUFFIX}`));
    assert.equal(written.card.shelf, 1);
    const parsed = parsePackCard(readFileSync(written.path, "utf8"));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.value, written.card);
      assert.match(parsed.value.icon, /^data:image\/svg\+xml;base64,/u);
    }
  });

  it("gives every published pack its shelf order and artwork", () => {
    const manifests = {
      canvas: { ...manifest, id: "canvas" },
      planner: {
        id: "planner",
        name: "Suite Planner",
        description: "A local-first day plan in one file.",
        version: "0.5.2",
      },
      budget: {
        id: "budget",
        name: "Suite Budget",
        description: "A local-first envelope budget.",
        version: "0.4.2",
      },
      help: {
        id: "help",
        name: "Suite Help",
        description: "The repository handbook and code explorer, offline in one pack.",
        version: "0.1.3",
      },
    };

    const shelves = [];
    for (const [id, value] of Object.entries(manifests)) {
      const written = writePackCard({
        archivePath: join(workspace(), `${id}-${value.version}.suitepack`),
        manifest: value,
      });
      assert.equal(written.card.id, id);
      assert.equal(written.card.packVersion, value.version);
      assert.equal(written.card.description, value.description);
      assert.match(written.card.icon, /^data:image\/(?:svg\+xml|png);base64,/u);
      shelves.push(written.card.shelf);
    }
    assert.deepEqual(shelves, [1, 2, 3, 4]);
  });

  it("refuses an unknown field, a bad format and a multi-line description", () => {
    assert.equal(parsePackCard({ ...card(), extra: true }).ok, false);
    assert.equal(parsePackCard({ ...card(), format: "suite.card" }).ok, false);
    assert.equal(parsePackCard({ ...card(), description: "two\nlines" }).ok, false);
    assert.equal(parsePackCard({ ...card(), icon: "not-a-data-uri" }).ok, false);
    assert.equal(parsePackCard({ ...card(), shelf: 0 }).ok, false);
    assert.equal(parsePackCard({ ...card(), packVersion: "latest" }).ok, false);
  });

  it("refuses a card larger than the cap before parsing it", () => {
    const huge = `${" ".repeat(MAX_CARD_BYTES)}${JSON.stringify(card())}`;
    const parsed = parsePackCard(huge);
    assert.equal(parsed.ok, false);
    assert.match(parsed.issues[0]?.message ?? "", /larger than/u);
  });
});
