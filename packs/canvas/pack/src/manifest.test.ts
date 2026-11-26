import { SCHEMA_VERSION, WORKSPACE_FILE_KIND } from "@suite/graph";
import { describe, expect, it } from "vitest";
import manifestText from "../manifest.json?raw";

/**
 * The source manifest and Canvas's document layer agree.
 *
 * The host stamps the envelope with the version the manifest declares, and the pack reads a payload
 * with the schema its graph writes. A drift between the two numbers would make the host refuse a
 * document the pack can read, or accept one it cannot, so this test reads the manifest the build
 * signs.
 *
 * The capability list is asserted too: it is what this pack actually uses, not every service the
 * vocabulary offers. `relay` is the host's opaque-frame service: the pack holds the keys and
 * seals its own frames, and never receives a general socket.
 */
const manifest = JSON.parse(manifestText) as {
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly optionalCapabilities?: readonly string[];
  readonly platforms?: readonly string[];
  readonly documents?: readonly {
    readonly id: string;
    readonly format: string;
    readonly version: number;
    readonly mode?: string;
  }[];
};

describe("Canvas's declared document", () => {
  it("declares the .canvas workspace at the current schema", () => {
    expect(manifest.documents).toEqual([
      {
        id: "canvas",
        format: WORKSPACE_FILE_KIND,
        version: SCHEMA_VERSION,
        mode: "multi",
      },
    ]);
  });

  it("asks the host only for what it uses", () => {
    // `documents` holds the workspace and its reveal/watch surface; `files` is the picker export,
    // import, folder import and the pack's sync keys; `recents` is the host's recent list.
    expect(manifest.capabilities).toEqual(["documents", "files", "recents"]);
  });

  it("declares the host relay as optional, so a host without one still installs", () => {
    // `relay` is the one pinned socket the host opens for opaque sync frames. Sync is optional
    // (S7.1): a host that does not serve the relay shows the local-only state, and the pack is
    // still installable on the phone, where the relay is not served yet.
    expect(manifest.optionalCapabilities).toEqual(["relay"]);
  });

  it("declares the hosts it is built for", () => {
    // The pack is one manifest for both hosts. Mobile layout is this pack's own job (#387); a
    // host that does not serve `relay` shows the local-only state rather than a refused door.
    expect(manifest.platforms).toEqual(["desktop", "mobile"]);
  });
});
