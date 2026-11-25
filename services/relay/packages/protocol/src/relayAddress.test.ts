import { describe, expect, it } from "vitest";
import { isLoopbackRelayUrl } from "./relayAddress.js";

describe("a loopback relay address", () => {
  it("accepts the loopback hosts in the forms a person or an app writes", () => {
    for (const value of [
      "127.0.0.1",
      "::1",
      "[::1]",
      "localhost",
      "ws://127.0.0.1:8787/sync",
      "ws://[::1]:8787/sync",
      "ws://localhost:8787/sync",
      "wss://localhost:8787/sync",
      "WS://LOCALHOST:8787/sync",
    ]) {
      expect(isLoopbackRelayUrl(value)).toBe(true);
    }
  });

  it("rejects every address that can leave the machine", () => {
    for (const value of [
      "",
      "192.168.1.20",
      "ws://192.168.1.20:8787/sync",
      "ws://relay.example:8787/sync",
      "ws://127.0.0.1.evil.example:8787/sync",
      "ws://[::2]:8787/sync",
      "localhost.evil.example",
      "not a relay url",
    ]) {
      expect(isLoopbackRelayUrl(value)).toBe(false);
    }
  });
});
