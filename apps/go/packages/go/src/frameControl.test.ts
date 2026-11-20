import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FRAME_PROTOCOL, type FrameControl } from "./frame.js";
import { requestFrameFlush } from "./frameControl.js";

type Listener = (event: { data: unknown }) => void;

let listeners: Set<Listener>;
let posted: FrameControl[];

beforeEach(() => {
  listeners = new Set();
  posted = [];
  (globalThis as unknown as { addEventListener: unknown }).addEventListener = (
    _type: string,
    listener: Listener,
  ) => listeners.add(listener);
  (globalThis as unknown as { removeEventListener: unknown }).removeEventListener = (
    _type: string,
    listener: Listener,
  ) => listeners.delete(listener);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "addEventListener");
  Reflect.deleteProperty(globalThis, "removeEventListener");
});

function target(): Window {
  return {
    postMessage: (message: FrameControl) => {
      posted.push(message);
    },
  } as unknown as Window;
}

function answer(ok: boolean, message?: string): void {
  const control = posted.at(-1);
  if (control === undefined) throw new Error("no control was posted");
  queueMicrotask(() => {
    for (const listener of listeners) {
      listener({
        data: {
          protocol: FRAME_PROTOCOL,
          id: control.id,
          ok,
          ...(message === undefined ? {} : { message }),
        },
      });
    }
  });
}

describe("asking a pack to flush", () => {
  it("posts a negative-id control, so a reply cannot be mistaken for a request reply", async () => {
    const pending = requestFrameFlush(target());
    await Promise.resolve();
    answer(true);
    await pending;

    expect(posted[0]?.control).toBe("flush");
    expect(posted[0]?.id ?? 0).toBeLessThan(0);
  });

  it("rejects with the pack's own message when the write failed", async () => {
    const pending = requestFrameFlush(target());
    await Promise.resolve();
    answer(false, "indexeddb is full");

    await expect(pending).rejects.toThrow(/indexeddb is full/u);
  });

  it("rejects when the frame never answers", async () => {
    await expect(requestFrameFlush(target(), { timeoutMs: 20 })).rejects.toThrow(
      /did not answer a flush/u,
    );
  });

  it("ignores a reply to somebody else's request", async () => {
    const pending = requestFrameFlush(target());
    await Promise.resolve();
    for (const listener of listeners) {
      listener({ data: { protocol: FRAME_PROTOCOL, id: 1, ok: true, value: null } });
    }

    // Still pending: a positive id is a pack request, not this control. Settle it explicitly.
    answer(true);
    await expect(pending).resolves.toBeUndefined();
  });
});
