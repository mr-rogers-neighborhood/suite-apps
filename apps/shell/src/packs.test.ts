import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSafePackPath } from "@suite/pack/manifest";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverPacks,
  externalLinkFor,
  packAllows,
  packOrigin,
  packPartition,
  packsRootFor,
  packUrl,
  resolvePackRequest,
  tabViewTarget,
} from "./packs.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-shell-packs-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writePack(
  root: string,
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  const manifest = {
    format: "suite.pack",
    id,
    name: id,
    version: "0.1.0",
    entry: "index.html",
    contractVersion: 1,
    capabilities: ["documents"],
    ...overrides,
  };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "index.html"), `<!doctype html><title>${id}</title>`);
}

describe("pack discovery", () => {
  it("finds valid packs and sorts them by name", async () => {
    const root = await temporaryRoot();
    await writePack(root, "welcome", { name: "Welcome" });
    await writePack(root, "scratch", { name: "Scratch" });

    const packs = discoverPacks(root);
    expect(packs.map((pack) => pack.id)).toEqual(["scratch", "welcome"]);
    expect(packs[0]?.capabilities).toEqual(["documents"]);
    expect(packs[0]?.root).toBe(join(root, "scratch"));
    expect(packs[0]?.source).toBe("development");
  });

  it("skips a manifest whose entry does not exist", async () => {
    const root = await temporaryRoot();
    await writePack(root, "broken", { entry: "missing.html" });
    expect(discoverPacks(root)).toEqual([]);
  });

  it("skips an unknown capability instead of widening the grant", async () => {
    const root = await temporaryRoot();
    await writePack(root, "sneaky", { capabilities: ["documents", "root"] });
    expect(discoverPacks(root)).toEqual([]);
  });

  it("does not treat an id with a slash as a pack", async () => {
    const root = await temporaryRoot();
    await writePack(root, "escape", { id: "../escape" });
    expect(discoverPacks(root)).toEqual([]);
  });

  it("refuses a pack built for a newer contract", async () => {
    const root = await temporaryRoot();
    await writePack(root, "future", { contractVersion: 99 });
    expect(discoverPacks(root)).toEqual([]);
  });

  it("refuses a pack that needs a newer host", async () => {
    const root = await temporaryRoot();
    await writePack(root, "future", { minimumHostVersion: 99 });
    expect(discoverPacks(root)).toEqual([]);
  });

  it("refuses a capability the host does not serve yet", async () => {
    const root = await temporaryRoot();
    await writePack(root, "relay", { capabilities: ["documents", "relay"] });
    expect(discoverPacks(root)).toEqual([]);
  });

  it("loads a pack that declares the files capability", async () => {
    const root = await temporaryRoot();
    await writePack(root, "conformance", { capabilities: ["documents", "files"] });

    const packs = discoverPacks(root);
    expect(packs).toHaveLength(1);
    expect(packs[0]?.capabilities).toEqual(["documents", "files"]);
  });

  it("loads one pack per id when two directories collide", async () => {
    const root = await temporaryRoot();
    await writePack(root, "first", { id: "duplicate", name: "First" });
    await writePack(root, "second", { id: "duplicate", name: "Second" });

    const packs = discoverPacks(root);
    expect(packs).toHaveLength(1);
    expect(packs[0]?.id).toBe("duplicate");
  });
});

describe("pack capabilities", () => {
  it("grants only what the manifest declares", () => {
    expect(packAllows({ capabilities: ["documents"] }, "documents")).toBe(true);
    expect(packAllows({ capabilities: ["documents"] }, "network")).toBe(false);
    expect(packAllows({ capabilities: [] }, "documents")).toBe(false);
  });

  it("hands a link to the OS browser only for a network pack", () => {
    expect(externalLinkFor({ capabilities: ["documents"] }, "https://example.com/x")).toBeNull();
    expect(externalLinkFor({ capabilities: ["network"] }, "https://example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(externalLinkFor({ capabilities: ["network"] }, "http://example.com/")).toBe(
      "http://example.com/",
    );
  });

  it("refuses a scheme the OS browser should not be asked to open", () => {
    expect(externalLinkFor({ capabilities: ["network"] }, "javascript:alert(1)")).toBeNull();
    expect(externalLinkFor({ capabilities: ["network"] }, "file:///etc/passwd")).toBeNull();
    expect(externalLinkFor({ capabilities: ["network"] }, "not a url")).toBeNull();
  });
});

describe("tab view target", () => {
  it("loads the installed pack's current entry, not the tab's recorded one", async () => {
    const root = await temporaryRoot();
    await writePack(root, "welcome");
    const packs = discoverPacks(root);

    const target = tabViewTarget(packs, { packId: "welcome", entry: "old/index.html" });
    expect(target?.url).toBe("suite-pack://default.welcome/index.html");
    expect(target?.pack.entry).toBe("index.html");
  });

  it("has no target when the pack is no longer installed", async () => {
    const root = await temporaryRoot();
    await writePack(root, "welcome");
    const packs = discoverPacks(root);

    expect(tabViewTarget(packs, { packId: "scratch", entry: "index.html" })).toBeNull();
  });
});

describe("pack identity", () => {
  it("puts the default container in the origin, URL and partition", () => {
    expect(packOrigin("welcome")).toBe("suite-pack://default.welcome");
    expect(packUrl("welcome", "index.html")).toBe("suite-pack://default.welcome/index.html");
    expect(packPartition("welcome")).toBe("persist:default:welcome");
  });

  it("accepts another container id without changing the shape", () => {
    expect(packOrigin("welcome", "work")).toBe("suite-pack://work.welcome");
    expect(packPartition("welcome", "work")).toBe("persist:work:welcome");
  });
});

describe("pack request resolution", () => {
  it("serves a file from that pack's own root", async () => {
    const root = await temporaryRoot();
    await writePack(root, "welcome");
    const packs = discoverPacks(root);

    const request = resolvePackRequest("suite-pack://default.welcome/index.html", packs);
    expect(request?.pack.id).toBe("welcome");
    expect(request?.file).toBe(join(root, "welcome", "index.html"));
  });

  it("refuses a climb before the URL parser can normalise it", async () => {
    const root = await temporaryRoot();
    await writePack(root, "welcome");
    const packs = discoverPacks(root);

    expect(resolvePackRequest("suite-pack://default.welcome/../secret", packs)).toBeNull();
    expect(resolvePackRequest("suite-pack://default.welcome/%2e%2e/secret", packs)).toBeNull();
  });

  it("refuses an unknown host", async () => {
    const root = await temporaryRoot();
    await writePack(root, "welcome");
    const packs = discoverPacks(root);

    expect(resolvePackRequest("suite-pack://default.scratch/index.html", packs)).toBeNull();
  });
});

describe("pack paths", () => {
  it("accepts relative paths with normal segments", () => {
    expect(isSafePackPath("index.html")).toBe(true);
    expect(isSafePackPath("assets/app.js")).toBe(true);
  });

  it("refuses absolute, climbing and control-character paths", () => {
    expect(isSafePackPath("/index.html")).toBe(false);
    expect(isSafePackPath("../index.html")).toBe(false);
    expect(isSafePackPath("a/../../b")).toBe(false);
    expect(isSafePackPath("a\\b")).toBe(false);
    expect(isSafePackPath("a\u0000b")).toBe(false);
  });
});

describe("pack root", () => {
  it("keeps development packs beside the checkout", () => {
    expect(packsRootFor("/repo/apps/shell")).toBe("/repo/apps/shell/packs");
  });
});
