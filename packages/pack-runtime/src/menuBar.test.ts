import { describe, expect, it, vi } from "vitest";
import {
  createMenuSlots,
  type MenuBarHostBridge,
  type MenuSlots,
  menuBarHost,
  subscribeMenuActions,
} from "./menuBar.js";

/** A host bridge that records what a pack published. */
function recordingBridge() {
  const published: MenuSlots[] = [];
  const listeners = new Set<(action: { id: string; item?: string }) => void>();
  const bridge: MenuBarHostBridge = {
    setSlots(slots) {
      published.push(slots);
    },
    onAction(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    bridge,
    published,
    press(action: { id: string; item?: string }) {
      for (const listener of listeners) listener(action);
    },
    listenerCount: () => listeners.size,
  };
}

const slots: MenuSlots = {
  format: "suite.menu-slots",
  title: "Q3 board",
  navigation: [{ kind: "toggle", id: "canvas.explain", label: "Explain mode", pressed: false }],
  actions: [],
};

describe("detecting a host", () => {
  it("finds the bridge only when a host exposes both halves", () => {
    const { bridge } = recordingBridge();
    expect(menuBarHost({ suite: { menuBar: bridge } })).toBe(bridge);
  });

  it("reports no host for a standalone window", () => {
    expect(menuBarHost({})).toBeNull();
    expect(menuBarHost({ suite: {} })).toBeNull();
    expect(menuBarHost({ suite: { menuBar: {} } })).toBeNull();
    expect(menuBarHost({ suite: { menuBar: { setSlots() {} } } })).toBeNull();
    expect(menuBarHost(null)).toBeNull();
    expect(menuBarHost("nope")).toBeNull();
  });
});

describe("publishing slots", () => {
  it("sends the value the host draws, validated first", () => {
    const host = recordingBridge();
    const handle = createMenuSlots(host.bridge);
    handle.publish(slots);

    expect(host.published).toHaveLength(1);
    expect(host.published[0]?.title).toBe("Q3 board");
    expect(handle.current()).toEqual(host.published[0]);
  });

  it("drops a malformed value and keeps the previous bar, rather than half-applying it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = recordingBridge();
    const handle = createMenuSlots(host.bridge);

    handle.publish(slots);
    handle.publish({ ...slots, navigation: [{ kind: "slider" }] } as unknown as MenuSlots);

    expect(host.published).toHaveLength(1);
    expect(handle.current()?.title).toBe("Q3 board");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("is a no-op without a host, so a standalone pack draws its own bar", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handle = createMenuSlots(null);
    expect(() => handle.publish(slots)).not.toThrow();
    expect(handle.current()).toBeNull();
    handle.dispose();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("forgets the value once disposed", () => {
    const host = recordingBridge();
    const handle = createMenuSlots(host.bridge);
    handle.publish(slots);
    handle.dispose();
    expect(handle.current()).toBeNull();
  });
});

describe("receiving a press", () => {
  it("hands back the id the pack itself put on the control", () => {
    const host = recordingBridge();
    const received: { id: string; item?: string }[] = [];
    const stop = subscribeMenuActions(host.bridge, (action) => received.push(action));

    host.press({ id: "canvas.explain" });
    host.press({ id: "canvas.boards", item: "canvas.board.q3" });

    expect(received).toEqual([
      { id: "canvas.explain" },
      { id: "canvas.boards", item: "canvas.board.q3" },
    ]);
    stop();
    host.press({ id: "canvas.explain" });
    expect(received).toHaveLength(2);
  });

  it("subscribes to nothing without a host", () => {
    const received: unknown[] = [];
    const stop = subscribeMenuActions(null, (action) => received.push(action));
    expect(() => stop()).not.toThrow();
    expect(received).toHaveLength(0);
  });
});
