import { describe, expect, it } from "vitest";
import { formatFingerprint } from "./fingerprint.js";
import { formatRelayLink, parseRelayLink } from "./relayLink.js";

const workspaceId = "a".repeat(64);
const inviteId = "b".repeat(64);
const fingerprint = formatFingerprint("cd".repeat(32));

describe("a relay code", () => {
  it("round-trips a relay address and its certificate fingerprint", () => {
    const details = {
      url: "wss://192.168.1.20:8787/sync",
      fingerprint,
      workspaceId: null,
      inviteId: null,
    };
    expect(parseRelayLink(formatRelayLink(details))).toEqual({ ok: true, value: details });
  });

  it("round-trips an invitation when one exists", () => {
    const details = {
      url: "wss://relay.example:8787/sync",
      fingerprint,
      workspaceId,
      inviteId,
    };
    expect(parseRelayLink(formatRelayLink(details))).toEqual({ ok: true, value: details });
  });

  it("is one line, URL-safe, and starts with the Suite scheme", () => {
    const link = formatRelayLink({
      url: "wss://192.168.1.20:8787/sync",
      fingerprint,
      workspaceId,
      inviteId,
    });
    expect(link).toMatch(/^suite:\/\/relay\?/u);
    expect(link).not.toMatch(/[\s\n\r]/u);
    expect(link).toMatch(/^[\x21-\x7e]+$/u);
    expect(link).toContain("u=wss%3A%2F%2F192.168.1.20%3A8787%2Fsync");
    expect(link).toContain("w=");
    expect(link).toContain("i=");
  });

  it("may omit the fingerprint on loopback plaintext", () => {
    const details = {
      url: "ws://127.0.0.1:8787/sync",
      fingerprint: null,
      workspaceId: null,
      inviteId: null,
    };
    expect(parseRelayLink(formatRelayLink(details))).toEqual({ ok: true, value: details });
  });

  it("refuses a wss relay without the pin that makes wss mean anything", () => {
    const link = `suite://relay?u=${encodeURIComponent("wss://relay.example/sync")}`;
    const parsed = parseRelayLink(link);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.reason).toContain("fingerprint");
  });

  it("refuses another scheme, another host and a malformed address", () => {
    expect(parseRelayLink("https://relay.example")).toMatchObject({ ok: false });
    expect(parseRelayLink("suite://join?h=wss://x")).toMatchObject({ ok: false });
    expect(parseRelayLink(`suite://relay?u=${encodeURIComponent("http://x")}`)).toMatchObject({
      ok: false,
    });
    expect(parseRelayLink("  ")).toMatchObject({ ok: false });
  });

  it("refuses a malformed fingerprint and half an invitation", () => {
    expect(
      parseRelayLink(`suite://relay?u=${encodeURIComponent("wss://relay.example/sync")}&f=nope`),
    ).toMatchObject({ ok: false });
    expect(
      parseRelayLink(
        `suite://relay?u=${encodeURIComponent("ws://127.0.0.1/sync")}&w=${workspaceId}`,
      ),
    ).toMatchObject({ ok: false });
  });

  it("normalises a fingerprint a person copied with spaces or lower case", () => {
    const parsed = parseRelayLink(
      `suite://relay?u=${encodeURIComponent("wss://relay.example/sync")}&f=${encodeURIComponent(
        fingerprint.toLowerCase().replaceAll(":", " "),
      )}`,
    );
    expect(parsed).toMatchObject({ ok: true, value: { fingerprint } });
  });
});
