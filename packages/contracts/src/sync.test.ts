import { describe, expect, it } from "vitest";
import {
  SUITE_SYNC_STATUSES,
  type SuiteSyncCapability,
  SuiteSyncCapabilityError,
  type SuiteSyncFrame,
  type SuiteSyncMember,
  type SuiteSyncMembershipChange,
  type SuiteSyncMembershipNotice,
  suiteSyncErrorSchema,
  suiteSyncStatusSchema,
} from "./sync.js";

/**
 * The boundary, as a test.
 *
 * A fake app holds a key and a document. It seals before touching the capability, so the fake
 * host — which implements the contract exactly as a host would — can only ever see ciphertext.
 * That is the property the contract exists for, and it is checked by looking for the document
 * text and the raw key in every byte the host received.
 */

const workspaceId = "c".repeat(64);
const relayUrl = "ws://127.0.0.1:8787/sync";
const documentText =
  '{"title":"Quarterly board","cards":["the unannounced acquisition is still private"]}';
const replyText = '{"note":"a private reply from the other device"}';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function newKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Seal a document payload the way an app or pack does before a host may carry it. */
async function seal(key: CryptoKey, text: string): Promise<SuiteSyncFrame> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(encoder.encode(text))),
  );
  const frame = new Uint8Array(iv.length + body.length);
  frame.set(iv);
  frame.set(body, iv.length);
  return frame;
}

async function open(key: CryptoKey, frame: SuiteSyncFrame): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(frame.subarray(0, 12)) },
    key,
    new Uint8Array(frame.subarray(12)),
  );
  return decoder.decode(plain);
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  const last = haystack.length - needle.length;
  for (let start = 0; start <= last; start += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/**
 * A host that implements only the contract.
 *
 * It records every frame the app hands over, can hand one back, and can announce a roster
 * change. It has no key and no way to read what it records.
 */
function fakeHost(members: readonly SuiteSyncMember[]) {
  const received: SuiteSyncFrame[] = [];
  const frameListeners = new Set<(frame: SuiteSyncFrame) => void>();
  const membershipListeners = new Set<(notice: SuiteSyncMembershipNotice) => void>();
  let roster = [...members];

  const capability: SuiteSyncCapability = {
    status: async () => ({ state: "syncing", count: 4 }),
    enable: async (requestedWorkspaceId, requestedRelayUrl) => {
      expect(requestedWorkspaceId).toBe(workspaceId);
      expect(requestedRelayUrl).toBe(relayUrl);
      return { state: "connecting" };
    },
    disable: async () => ({ state: "off" }),
    invite: async (role) => {
      expect(role).toBe("editor");
      return "suite://join?invite=one";
    },
    join: async () => ({ state: "waiting" }),
    members: async () => roster,
    send: async (frame) => {
      received.push(frame);
    },
    onFrame: (listener) => {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    onMembership: (listener) => {
      membershipListeners.add(listener);
      return () => {
        membershipListeners.delete(listener);
      };
    },
  };

  return {
    capability,
    received,
    deliver(frame: SuiteSyncFrame) {
      for (const listener of frameListeners) listener(frame);
    },
    change(next: readonly SuiteSyncMember[], change: SuiteSyncMembershipChange) {
      roster = [...next];
      const notice = { change, members: roster };
      for (const listener of membershipListeners) listener(notice);
    },
  };
}

const device: SuiteSyncMember = {
  deviceId: "d".repeat(64),
  name: "Aurora's laptop",
  role: "owner",
};

describe("the sync capability", () => {
  it("carries only sealed frames and readable membership to the host side", async () => {
    const key = await newKey();
    const keyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const keyHex = Array.from(keyBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const keyBase64 = btoa(String.fromCharCode(...keyBytes));
    const host = fakeHost([device]);

    await host.capability.send(await seal(key, documentText));
    await host.capability.send(await seal(key, '{"another":"private update"}'));

    expect(host.received).toHaveLength(2);
    const hostText = host.received.map((frame) => decoder.decode(frame)).join(" ");
    for (const frame of host.received) {
      expect(containsBytes(frame, encoder.encode(documentText))).toBe(false);
      expect(containsBytes(frame, encoder.encode("unannounced acquisition"))).toBe(false);
      expect(containsBytes(frame, keyBytes)).toBe(false);
    }
    expect(hostText).not.toContain("Quarterly board");
    expect(hostText).not.toContain(keyHex);
    expect(hostText).not.toContain(keyBase64);

    const notices: string[] = [];
    host.capability.onMembership((notice) => notices.push(JSON.stringify(notice)));
    host.change([device, { deviceId: "e".repeat(64), name: "Phone", role: "viewer" }], "joined");

    expect(notices).toHaveLength(1);
    expect(notices[0] ?? "").toContain(device.deviceId);
    expect(notices[0] ?? "").not.toContain("Quarterly board");
    expect(notices[0] ?? "").not.toContain(keyHex);
    expect(notices[0] ?? "").not.toContain(keyBase64);
  });

  it("hands a sealed frame to the app, which is the only side that can open it", async () => {
    const appKey = await newKey();
    const host = fakeHost([device]);
    const opened: string[] = [];
    host.capability.onFrame((frame) => {
      void open(appKey, frame).then((text) => opened.push(text));
    });

    await host.capability.send(await seal(appKey, documentText));
    host.deliver(await seal(appKey, replyText));
    // The reply is opened by the app, not by the host that moved it.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.received).toHaveLength(1);
    expect(await open(appKey, host.received[0] as SuiteSyncFrame)).toBe(documentText);
    expect(opened).toEqual([replyText]);
  });

  it("offers every state a person can act on", async () => {
    const states = [
      { state: "off" },
      { state: "connecting" },
      { state: "syncing", count: 3 },
      { state: "asleep", reason: "the relay is not answering" },
      { state: "refused", reason: "viewers may not write" },
      { state: "waiting" },
      { state: "removed" },
    ] as const;

    expect(states.map((status) => status.state)).toEqual(SUITE_SYNC_STATUSES);
    for (const status of states) {
      expect(suiteSyncStatusSchema.parse(status)).toEqual(status);
    }
    await expect(fakeHost([device]).capability.status()).resolves.toEqual({
      state: "syncing",
      count: 4,
    });
  });

  it("names the failed operation without naming what the app was holding", () => {
    const failure = new SuiteSyncCapabilityError(
      "invite",
      "not-connected",
      "Sync is not connected. Enable it before writing an invitation.",
    );

    expect(suiteSyncErrorSchema.parse(failure.toJSON())).toEqual({
      code: "not-connected",
      operation: "invite",
      message: "Sync is not connected. Enable it before writing an invitation.",
    });
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).not.toContain("Quarterly");
    expect(failure.message).not.toContain("acquisition");
    expect(() =>
      suiteSyncErrorSchema.parse({ code: "torn", operation: "invite", message: "no" }),
    ).toThrow();
  });
});
