import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYNC_CHANGED, SYNC_IPC } from "./shared.js";

/**
 * The preload cannot import the shared constants, so its channel names are spelled out. This
 * is what stops them drifting: a rename fails here rather than at runtime, where the symptom
 * is a button in the window that does nothing.
 */
const here = dirname(fileURLToPath(import.meta.url));
const preload = readFileSync(join(here, "preload", "index.cjs"), "utf8");

describe("the window bridge", () => {
  it.each(Object.entries(SYNC_IPC))(
    "names the %s channel exactly as shared.ts does",
    (_name, channel) => {
      expect(preload).toContain(`"${channel}"`);
    },
  );

  it("exposes the one global the page looks for", () => {
    expect(preload).toContain('exposeInMainWorld("suiteSync"');
  });

  it("listens on the channel main broadcasts to", () => {
    expect(preload).toContain(`"${SYNC_CHANGED}"`);
  });

  it("takes no path, URL or command from the page", () => {
    expect(preload).not.toMatch(/openPath|writeFile|readFile|exec|spawn/u);
  });
});
