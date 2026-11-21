import { parseRelayLink } from "@suite/sync";
import { describe, expect, it } from "vitest";
import { relayCode } from "./syncCode.js";

const fingerprint = `AA:${"BB:".repeat(30)}CC`;

describe("Start's relay code", () => {
  it("round-trips the address and fingerprint a phone would scan", () => {
    const qr = relayCode("wss://192.168.1.20:8787/sync", fingerprint);
    expect(qr).not.toBeNull();
    expect(qr?.size).toBeGreaterThan(20);
    expect(qr?.rows).toHaveLength(qr?.size ?? 0);

    const parsed = parseRelayLink(qr?.payload ?? "");
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        url: "wss://192.168.1.20:8787/sync",
        fingerprint,
        workspaceId: null,
        inviteId: null,
      },
    });
  });

  it("still makes a code for loopback plaintext", () => {
    const parsed = parseRelayLink(relayCode("ws://127.0.0.1:8787/sync", null)?.payload ?? "");
    expect(parsed).toMatchObject({ ok: true, value: { url: "ws://127.0.0.1:8787/sync" } });
  });

  it("has no code while the relay is stopped", () => {
    expect(relayCode(null, fingerprint)).toBeNull();
  });
});
