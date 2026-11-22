import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHROME_IPC, CHROME_STATE, PACK_IPC } from "./shared.js";

const here = dirname(fileURLToPath(import.meta.url));
const chrome = readFileSync(join(here, "preload", "chrome.cjs"), "utf8");
const pack = readFileSync(join(here, "preload", "pack.cjs"), "utf8");

describe("the chrome bridge", () => {
  it.each(Object.entries(CHROME_IPC))(
    "names the %s channel exactly as shared.ts does",
    (_name, channel) => {
      expect(chrome).toContain(`"${channel}"`);
    },
  );

  it("exposes install as host chrome, never to a pack", () => {
    expect(chrome).toContain("installPack: () =>");
    expect(pack).not.toContain("suite:shell:install-pack");
  });

  it("listens on the channel the main process broadcasts to", () => {
    expect(chrome).toContain(`"${CHROME_STATE}"`);
  });

  it("exposes the one global the chrome page looks for", () => {
    expect(chrome).toContain('exposeInMainWorld("suiteShell"');
  });
});

describe("the pack bridge", () => {
  it.each(Object.entries(PACK_IPC))(
    "names the %s channel exactly as shared.ts does",
    (_name, channel) => {
      expect(pack).toContain(`"${channel}"`);
    },
  );

  it("exposes the one global a pack looks for", () => {
    expect(pack).toContain('exposeInMainWorld("suite"');
  });

  it("exposes the files service under the pack-side method names", () => {
    expect(pack).toContain("files: {");
    for (const method of [
      "list",
      "stat",
      "mkdir",
      "read",
      "write",
      "rename",
      "remove",
      "backup",
      "lock",
    ]) {
      expect(pack).toContain(`${method}:`);
    }
  });

  it("does not hand a pack a filesystem or a process", () => {
    expect(pack).not.toMatch(/node:fs|node:path|require\("fs"\)|process\.binding/u);
    expect(pack).not.toMatch(/readFile|writeFile|resolve\(/u);
  });
});
