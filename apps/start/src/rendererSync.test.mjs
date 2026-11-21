import { beforeEach, describe, expect, it } from "vitest";
import { renderSync } from "./renderer/sync.js";

/**
 * The Sync pane describes a deployment, not a relay.
 *
 * A `hub.json` from an older Start could still carry a running address. Even if one
 * found its way into the state object, the pane must not draw it: the tray app owns
 * the address, and a stale one would be a link to nothing.
 */

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = [];
    this.className = "";
    this.id = "";
    this.title = "";
    this.hidden = false;
    this.textContent = "";
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    this.listeners.push([type, listener]);
  }
}

let panel;

beforeEach(() => {
  panel = new FakeNode("panel");
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (_namespace, tag) => new FakeNode(tag),
    getElementById: (id) => (id === "panel-sync" ? panel : null),
  };
});

const actions = { installSync: () => undefined, openSync: () => undefined };

function textOf(node) {
  if (typeof node === "string") return node;
  return [node.textContent, ...node.children.map(textOf)].join(" ");
}

describe("the Sync pane", () => {
  it("never draws a relay address that a legacy report could carry", () => {
    const stale = "ws://192.0.2.10:8787/sync";
    renderSync(
      {
        sync: {
          state: "installed",
          version: "0.11.3",
          commit: "b".repeat(64),
          problem: null,
          // A stale report must not become a pane field even if it leaks in.
          address: stale,
          fingerprint: "AA:BB",
          consoleUrl: "http://127.0.0.1:8787/console?token=dead",
        },
      },
      actions,
    );

    const text = textOf(panel);
    expect(text).toContain("Open Suite Sync");
    expect(text).not.toContain(stale);
    expect(text).not.toContain("ws://");
    expect(text).not.toContain("AA:BB");
    expect(text).not.toContain("console");
  });

  it("offers Install only when the deployment is absent, and Open when it is there", () => {
    const ids = (node) => [
      node.id,
      ...node.children.flatMap((child) => (typeof child === "string" ? [] : ids(child))),
    ];

    renderSync(
      { sync: { state: "not-installed", version: null, commit: null, problem: null } },
      actions,
    );
    expect(ids(panel)).toContain("sync-install");
    expect(ids(panel)).not.toContain("sync-open");

    renderSync(
      {
        sync: {
          state: "installed",
          version: "0.11.3",
          commit: "b".repeat(64),
          problem: null,
        },
      },
      actions,
    );
    expect(ids(panel)).toContain("sync-open");
    expect(ids(panel)).not.toContain("sync-install");
  });
});
