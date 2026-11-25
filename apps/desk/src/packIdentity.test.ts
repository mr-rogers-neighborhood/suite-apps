import { describe, expect, it } from "vitest";
import {
  documentScopeLabel,
  documentsRootFor,
  FIRST_PARTY_PUBLISHER_ID,
  packStorageKey,
} from "./packIdentity.js";
import { packPartition } from "./packs.js";

describe("publisher-scoped storage", () => {
  // spec: S2.2
  it("keeps the first-party publisher on its pre-S2.1 path", () => {
    // Existing documents and files are not moved: the first-party segment stays
    // the bare pack id, and only the pinned key can reach it.
    expect(FIRST_PARTY_PUBLISHER_ID).toBe("suite");
    expect(packStorageKey("suite", "canvas")).toBe("canvas");
    expect(documentsRootFor("/data", "suite")).toBe("/data/documents");
    expect(documentScopeLabel("suite")).toBeNull();
    expect(packPartition("canvas", "default", "suite")).toBe("persist:default:canvas");
  });

  // spec: S2.2
  it("gives another publisher a different segment, root and session", () => {
    expect(packStorageKey("acme", "canvas")).toBe("acme~canvas");
    expect(documentsRootFor("/data", "acme")).toBe("/data/documents/acme");
    expect(documentScopeLabel("acme")).toBe("acme");
    expect(packPartition("canvas", "default", "acme")).not.toBe(
      packPartition("canvas", "default", "suite"),
    );
    expect(packPartition("canvas", "default", "acme")).not.toBe(
      packPartition("canvas", "default", "other"),
    );
  });

  // spec: S2.2
  it("refuses an id that would leave the storage root", () => {
    expect(() => packStorageKey("../acme", "canvas")).toThrow(/publisher id/u);
    expect(() => packStorageKey("acme", "../canvas")).toThrow(/pack id/u);
    expect(() => documentsRootFor("/data", "Acme")).toThrow(/publisher id/u);
    expect(() => packStorageKey("suite", "canvas")).not.toThrow();
  });
});
