import type { RelayWebSocket } from "@suite/sync";
import {
  PIN_MALFORMED_MESSAGE as NODE_PIN_MALFORMED,
  PIN_REQUIRED_MESSAGE as NODE_PIN_REQUIRED,
} from "@suite/sync/node";
import { describe, expect, it } from "vitest";

import { PIN_MALFORMED_MESSAGE, PIN_REQUIRED_MESSAGE } from "./core.js";
import { relaySocketFor } from "./relay.js";

describe("the renderer sync entry", () => {
  it("keeps the Node pin sentences word for word", () => {
    // The core has no `node:` import, so the two lines a person reads are copied. A drift
    // would make the same certificate problem read two ways depending on the host.
    expect(PIN_REQUIRED_MESSAGE).toBe(NODE_PIN_REQUIRED);
    expect(PIN_MALFORMED_MESSAGE).toBe(NODE_PIN_MALFORMED);
  });

  it("hands the core a factory for the caller's socket, whatever the pin", () => {
    const socket = { send: () => undefined, close: () => undefined } as unknown as RelayWebSocket;
    const open = relaySocketFor(() => socket);
    expect(open(null)("ws://127.0.0.1:8787/sync")).toBe(socket);
    expect(open("AB".repeat(32))("wss://relay.example/sync")).toBe(socket);
  });
});
