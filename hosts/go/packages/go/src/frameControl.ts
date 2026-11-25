import { FRAME_PROTOCOL, type FrameControl, isFrameReply } from "./frame.js";

/**
 * The shell's half of a pack's durability boundary.
 *
 * A pack owns its document, so the only thing the shell can do at a boundary is ask the pack to
 * write and wait for the answer. The answer arrives as an ordinary `FrameReply`, on the same
 * protocol, which is why there is no second reply type.
 *
 * Control ids are negative: the pack's own requests count up from 1, so a reply to a control can
 * never be mistaken for a reply to a request when both are in flight.
 */
const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;
let nextControlId = -1;

export interface FlushOptions {
  readonly timeoutMs?: number;
}

export function requestFrameFlush(target: Window, options: FlushOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  const id = nextControlId;
  nextControlId -= 1;

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      globalThis.removeEventListener("message", listener);
    };

    const listener = (event: MessageEvent) => {
      if (!isFrameReply(event.data) || event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve();
      else reject(new Error(event.data.message || "the pack did not flush its document"));
    };

    timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `the pack did not answer a flush within ${timeoutMs} ms; ` +
            "its last edits may not have reached the document",
        ),
      );
    }, timeoutMs);

    globalThis.addEventListener("message", listener);
    const control: FrameControl = { protocol: FRAME_PROTOCOL, id, control: "flush" };
    target.postMessage(control, "*");
  });
}
