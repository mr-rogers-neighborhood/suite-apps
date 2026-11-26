import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHROME_IPC,
  CHROME_PICK,
  CHROME_STATE,
  PACK_EVENT,
  PACK_IPC,
  PACK_PROJECTION,
} from "./shared.js";

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

  it("exposes install and lifecycle as host chrome, never to a pack", () => {
    expect(chrome).toContain("installPack: () =>");
    expect(chrome).toContain("installCataloguePack: (id, version) =>");
    expect(chrome).toContain("uninstallPack: (id, version) =>");
    expect(pack).not.toContain("suite:shell:install-pack");
    expect(pack).not.toContain("suite:shell:install-catalogue-pack");
    expect(pack).not.toContain("suite:shell:uninstall-pack");
  });

  it("listens on the channel the main process broadcasts to", () => {
    expect(chrome).toContain(`"${CHROME_STATE}"`);
  });

  it("listens for the picker request and hands it to the page", () => {
    expect(chrome).toContain(`"${CHROME_PICK}"`);
    expect(chrome).toContain("onPick: (listener) =>");
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

  it.each(Object.entries(PACK_PROJECTION))(
    "names the %s projection channel exactly as shared.ts does",
    (_name, channel) => {
      expect(pack).toContain(`"${channel}"`);
    },
  );

  it.each(Object.entries(PACK_EVENT))(
    "names the %s pack event exactly as shared.ts does",
    (_name, channel) => {
      expect(pack).toContain(`"${channel}"`);
    },
  );

  it("exposes the one global a pack looks for", () => {
    expect(pack).toContain('exposeInMainWorld("suite"');
  });

  it("exposes the launch context as an async call", () => {
    expect(pack).toContain("launch: () => ipcRenderer.invoke");
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
      "pickOpen",
      "pickSave",
      "importFile",
      "importFolder",
    ]) {
      expect(pack).toContain(`${method}:`);
    }
  });

  it("exposes the library half of the documents service and the recent list", () => {
    expect(pack).toContain("documents: {");
    for (const method of ["reveal", "pendingChanges", "onChanged"]) {
      expect(pack).toContain(`${method}:`);
    }
    expect(pack).toContain("recents: {");
    expect(pack).toContain("forget:");
  });

  it("keeps an external handle's token out of the object the pack receives", () => {
    // The token lives in a WeakMap; the handle carries functions and `info`,
    // and only the bridge can spend it.
    expect(pack).toContain("issuedTokens.set(handle, issued.token)");
    expect(pack).not.toContain("token: issued.token");
  });

  it("does not hand a pack a filesystem or a process", () => {
    expect(pack).not.toMatch(/node:fs|node:path|require\("fs"\)|process\.binding/u);
    expect(pack).not.toMatch(/readFile|writeFile|resolve\(/u);
  });
});
