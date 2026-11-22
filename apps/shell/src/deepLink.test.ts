import { describe, expect, it } from "vitest";
import {
  LAUNCHER_CONTEXT,
  launchContextForLink,
  parseSuiteLink,
  suiteLinkFromArgv,
} from "./deepLink.js";
import type { PackInfo } from "./packs.js";

const packs: readonly PackInfo[] = [
  {
    id: "welcome",
    name: "Welcome",
    version: "1.0.0",
    description: null,
    entry: "index.html",
    capabilities: ["documents"],
    root: "/packs/welcome/1.0.0",
    source: "installed",
  },
  {
    id: "empty",
    name: "Empty",
    version: "1.0.0",
    description: null,
    entry: "  ",
    capabilities: [],
    root: "/packs/empty/1.0.0",
    source: "installed",
  },
];

describe("suite link parsing", () => {
  it("routes a link to the installed pack and carries a deep-link launch context", () => {
    const result = parseSuiteLink("suite://welcome/notes/today", packs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.pack.id).toBe("welcome");
    expect(result.value.path).toBe("notes/today");
    expect(result.value.launch).toEqual({
      kind: "deep-link",
      url: "suite://welcome/notes/today",
    });
  });

  it("refuses a malformed pack id", () => {
    expect(parseSuiteLink("suite://Not_A_Pack/notes", packs)).toMatchObject({
      ok: false,
      reason: "malformed-id",
    });
  });

  it("refuses an unknown or uninstalled pack", () => {
    expect(parseSuiteLink("suite://planner/workspace/x.planner", packs)).toMatchObject({
      ok: false,
      reason: "unknown-pack",
    });
  });

  it("refuses a pack with no entry", () => {
    expect(parseSuiteLink("suite://empty/notes", packs)).toMatchObject({
      ok: false,
      reason: "no-entry",
    });
  });

  it("refuses a link that is not a Suite link", () => {
    expect(parseSuiteLink("https://example.com", packs)).toMatchObject({ ok: false });
    expect(parseSuiteLink("suite-pack://default.welcome/index.html", packs)).toMatchObject({
      ok: false,
      reason: "not-a-suite-url",
    });
  });

  it("refuses credentials or a port", () => {
    expect(parseSuiteLink("suite://user:welcome@welcome/notes", packs)).toMatchObject({
      ok: false,
      reason: "credentials-or-port",
    });
  });
});

describe("launch contexts", () => {
  it("is the launcher context for a plain open", () => {
    expect(launchContextForLink(null)).toBe(LAUNCHER_CONTEXT);
    expect(LAUNCHER_CONTEXT).toEqual({ kind: "launcher" });
  });

  it("is the deep-link context with the URL for a link", () => {
    expect(launchContextForLink("suite://welcome/notes")).toEqual({
      kind: "deep-link",
      url: "suite://welcome/notes",
    });
  });
});

describe("command-line links", () => {
  it("finds a Suite link in argv and ignores other arguments", () => {
    expect(suiteLinkFromArgv(["suite", "--flag", "suite://welcome/x"])).toBe("suite://welcome/x");
    expect(suiteLinkFromArgv(["suite", "--flag"])).toBeNull();
  });
});
