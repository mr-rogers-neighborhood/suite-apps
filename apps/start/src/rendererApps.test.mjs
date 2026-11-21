import { beforeEach, describe, expect, it } from "vitest";
import { isPreReleaseCard, partitionCards, renderApps } from "./renderer/apps.js";

/**
 * The Apps pane's two lists.
 *
 * The page is plain DOM, so this uses the smallest document it needs: elements
 * with children, a dataset and a hidden flag. The question here is which list a
 * card lands in and whether the section exists, not how a browser paints it.
 */

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = [];
    this.className = "";
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

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    this.listeners.push([type, listener]);
  }
}

const IDS = ["apps", "apps-empty", "apps-pre-release", "apps-pre-release-list"];

let nodes;
beforeEach(() => {
  nodes = new Map(IDS.map((id) => [id, new FakeNode(id)]));
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    getElementById: (id) => nodes.get(id) ?? null,
  };
});

function card(overrides = {}) {
  return {
    id: "canvas",
    name: "Suite Canvas",
    source: "folder",
    icon: null,
    state: "current",
    version: "0.1.0",
    reason: null,
    running: false,
    channel: "alpha",
    tier: "stable",
    switchTier: null,
    executable: "/opt/suite/canvas",
    fileExtensions: ["canvas"],
    lastOpenedAt: null,
    fileCount: 0,
    health: { ok: true },
    ...overrides,
  };
}

const actions = {
  install: () => undefined,
  launch: () => undefined,
  remove: () => undefined,
  uninstall: () => undefined,
  reveal: () => undefined,
};

function render(cards, self = card({ id: "start", name: "Suite Start" })) {
  renderApps({ apps: cards, self }, actions);
  return {
    stable: nodes.get("apps").children,
    preRelease: nodes.get("apps-pre-release-list").children,
    section: nodes.get("apps-pre-release"),
  };
}

describe("the Apps pane's pre-release section", () => {
  it("keeps stable cards in the list and moves pre-release cards into the section", () => {
    const { stable, preRelease, section } = render([
      card(),
      card({
        id: "slop-canvas",
        name: "Suite Canvas (pre-release)",
        source: "flatpak",
        tier: "canary",
        switchTier: "beta",
      }),
    ]);

    expect(stable.map((node) => node.dataset.appId)).toEqual(["canvas", "start"]);
    expect(preRelease.map((node) => node.dataset.appId)).toEqual(["slop-canvas"]);
    expect(section.hidden).toBe(false);
  });

  it("hides the section when the filter leaves no pre-release card", () => {
    const { stable, preRelease, section } = render([card()]);

    expect(stable.map((node) => node.dataset.appId)).toEqual(["canvas", "start"]);
    expect(preRelease).toEqual([]);
    expect(section.hidden).toBe(true);
  });

  it("leaves the caution to the section, not each pre-release card", () => {
    const { preRelease } = render([
      card({ id: "slop-canvas", name: "Suite Canvas (pre-release)" }),
    ]);
    const text = preRelease[0].children
      .map((child) => (typeof child === "string" ? child : child.textContent))
      .join(" ");

    expect(text).not.toContain("may be broken");
    expect(text).not.toContain("uninstalling asks");
  });

  it("recognises both id forms and refuses a bare prefix", () => {
    expect(isPreReleaseCard({ id: "slop-canvas" })).toBe(true);
    expect(isPreReleaseCard({ id: "slop.canvas" })).toBe(true);
    expect(isPreReleaseCard({ id: "slop-" })).toBe(false);
    expect(isPreReleaseCard({ id: null })).toBe(false);
  });

  it("partitions cards without dropping or reordering either side", () => {
    const stable = card();
    const preRelease = card({ id: "slop-planner", name: "Suite Planner (pre-release)" });
    expect(partitionCards([stable, preRelease])).toEqual({
      stable: [stable],
      preRelease: [preRelease],
    });
  });
});
