import { RelayPinError } from "@suite/sync/node";
import { describe, expect, it } from "vitest";
import { createHostRelayWebSocketFactory } from "./transport";
import { fakeRelay } from "./testingRelay";

describe("the host relay transport", () => {
  it("forwards bytes both ways and reports the host's close", async () => {
    const host = fakeRelay();
    const socket = createHostRelayWebSocketFactory({
      relay: host.relay,
      pinFor: () => null,
    })("ws://127.0.0.1:8787/sync");

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", (event) => reject(event.error));
    });

    const frames: string[] = [];
    let closed = false;
    socket.addEventListener("message", (event) => frames.push(String(event.data)));
    socket.addEventListener("close", () => {
      closed = true;
    });

    socket.send("a sealed frame");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.sent).toHaveLength(1);
    expect(new TextDecoder().decode(host.sent[0])).toBe("a sealed frame");

    host.deliver(new TextEncoder().encode('{"type":"joined"}'));
    expect(frames).toEqual(['{"type":"joined"}']);

    host.close("the relay went away");
    expect(closed).toBe(true);
  });

  it("turns a missing relay capability into a final refusal, not a retry", async () => {
    const host = fakeRelay({ refuse: "the relay capability is not enabled for this pack" });
    const socket = createHostRelayWebSocketFactory({
      relay: host.relay,
      pinFor: () => null,
    })("ws://127.0.0.1:8787/sync");

    const failure = await new Promise<Error>((resolve) => {
      socket.addEventListener("error", (event) => resolve(event.error ?? new Error("no error")));
    });

    expect(failure).toBeInstanceOf(RelayPinError);
    expect(failure.message).toMatch(/relay capability/u);
  });

  it("refuses a wss relay without a pin before it asks the host", () => {
    const host = fakeRelay();
    const socket = createHostRelayWebSocketFactory({
      relay: host.relay,
      pinFor: () => null,
    })("wss://relay.invalid/sync");

    return new Promise<void>((resolve) => {
      socket.addEventListener("error", (event) => {
        expect(event.error?.message).toMatch(/fingerprint is required/u);
        expect(host.connectOptions()).toHaveLength(0);
        resolve();
      });
    });
  });
});
