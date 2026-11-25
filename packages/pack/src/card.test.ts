import { describe, expect, it } from "vitest";
import {
  CARD_SUFFIX,
  cardFileNameFor,
  cardUrlForArchiveUrl,
  MAX_CARD_BYTES,
  PACK_CARD_FORMAT,
  PACK_CARD_VERSION,
  type PackCard,
  parsePackCard,
} from "./index.js";

function card(overrides: Partial<PackCard> = {}): PackCard {
  return {
    format: PACK_CARD_FORMAT,
    version: PACK_CARD_VERSION,
    id: "canvas",
    packVersion: "0.1.13",
    name: "Suite Canvas",
    description: "A local-first canvas of boards, cards and links.",
    shelf: 1,
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    ...overrides,
  };
}

describe("pack cards", () => {
  it("names the card beside the archive and derives its URL from the archive URL", () => {
    expect(cardFileNameFor("canvas-0.1.13.suitepack")).toBe(`canvas-0.1.13${CARD_SUFFIX}`);
    expect(cardUrlForArchiveUrl("https://flatpak.suite.run/packs/canvas-0.1.13.suitepack")).toBe(
      `https://flatpak.suite.run/packs/canvas-0.1.13${CARD_SUFFIX}`,
    );
    // A query survives; a fragment never reaches a server and is dropped.
    expect(
      cardUrlForArchiveUrl("https://flatpak.suite.run/packs/canvas-0.1.13.suitepack?v=1#x"),
    ).toBe(`https://flatpak.suite.run/packs/canvas-0.1.13${CARD_SUFFIX}?v=1`);
    expect(() => cardFileNameFor("canvas.zip")).toThrow(/\.suitepack/u);
    expect(() => cardUrlForArchiveUrl("https://flatpak.suite.run/packs/canvas.zip")).toThrow(
      /\.suitepack/u,
    );
  });

  it("accepts an object and the same card as JSON text", () => {
    const value = card();
    expect(parsePackCard(value)).toEqual({ ok: true, value });
    expect(parsePackCard(JSON.stringify(value))).toEqual({ ok: true, value });
  });

  it("refuses a closed field set the host does not implement", () => {
    const parsed = parsePackCard({ ...card(), extra: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.some((issue) => issue.path === "extra")).toBe(true);
    }
  });

  it("refuses a wrong format, version, id, pack version or shelf", () => {
    const cases: Array<Partial<PackCard>> = [
      { format: "suite.card" as never },
      { version: 2 as never },
      { id: "Not Safe" },
      { packVersion: "latest" },
      { shelf: 0 },
    ];
    for (const overrides of cases) {
      expect(parsePackCard(card(overrides)).ok).toBe(false);
    }
  });

  it("requires a one-line description and a base64 icon data URI", () => {
    expect(parsePackCard(card({ description: "two\nlines" })).ok).toBe(false);
    expect(parsePackCard(card({ description: "" })).ok).toBe(false);
    expect(parsePackCard(card({ icon: "not-a-data-uri" })).ok).toBe(false);
    expect(parsePackCard(card({ name: "" })).ok).toBe(false);
  });

  it("refuses a card larger than the cap before parsing it", () => {
    const huge = `${" ".repeat(MAX_CARD_BYTES)}${JSON.stringify(card())}`;
    const parsed = parsePackCard(huge);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]?.message).toMatch(/larger than/u);
  });

  it("refuses text that is not JSON or not an object", () => {
    expect(parsePackCard("{not json").ok).toBe(false);
    expect(parsePackCard("[]").ok).toBe(false);
    expect(parsePackCard(null).ok).toBe(false);
  });
});
