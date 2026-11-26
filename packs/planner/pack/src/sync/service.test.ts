import { deriveFriendCode } from "@suite/sync";
import { WorkspaceDocument } from "@suite/planner-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlannerSync, type PlannerSync } from "./service";
import { memoryScopedFiles } from "./testFiles";
import { fakeRelay } from "./testingRelay";

const now = new Date("2026-11-24T09:00:00.000Z");
const SOME_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function setup(options: { readonly refuse?: string } = {}) {
  const store = memoryScopedFiles();
  const relay = fakeRelay(options.refuse === undefined ? {} : { refuse: options.refuse });
  let snapshot: Uint8Array | null = null;
  const updates: Uint8Array[] = [];
  const service = createPlannerSync({
    host: { relay: relay.relay, files: store.service, info: async () => ({ platform: "linux" }) },
    workspace: async () => "workspace_1",
    onDocumentUpdate: (update) => {
      updates.push(update);
    },
    onDocumentSnapshot: () => snapshot,
    now: () => now,
  });
  return {
    store,
    relay,
    service,
    updates,
    setSnapshot(bytes: Uint8Array | null) {
      snapshot = bytes;
    },
  };
}

const running: PlannerSync[] = [];

afterEach(async () => {
  for (const service of running.splice(0)) await service.dispose();
  localStorage.clear();
});

describe("Planner's pack sync", () => {
  it("reports a host that refuses the relay capability as refused, not offline", async () => {
    const { service } = setup({ refuse: "the relay capability is not enabled for this pack" });
    running.push(service);

    const info = await service.enable("ws://127.0.0.1:8787/sync");

    expect(info.status.state).toBe("refused");
    if (info.status.state === "refused") {
      expect(info.status.reason).toMatch(/relay capability/u);
    }
  });

  it("keeps the installation key and contacts in the pack's own files root", async () => {
    const { service, store } = setup();
    running.push(service);
    const first = await service.info();
    await service.addContact({ code: deriveFriendCode(SOME_KEY), name: "Ada" });
    await service.dispose();
    running.pop();

    const second = createPlannerSync({
      host: { files: store.service },
      workspace: async () => "workspace_1",
      onDocumentUpdate: () => undefined,
      onDocumentSnapshot: () => null,
      now: () => now,
    });
    running.push(second);
    const again = await second.info();

    expect(again.deviceId).toBe(first.deviceId);
    expect(again.friendCode).toBe(first.friendCode);
    expect(again.contacts.map((contact) => contact.name)).toEqual(["Ada"]);
    expect(store.files.has("sync/identity.json")).toBe(true);
    expect(store.files.has("sync/contacts.json")).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it("seals a document update before the host sees it", async () => {
    const { service, relay, setSnapshot } = setup();
    running.push(service);
    const doc = WorkspaceDocument.create({ now });
    doc.createTask({ title: "A secret task title" }, now);
    const snapshot = doc.snapshot();
    setSnapshot(snapshot);

    const info = await service.enable("ws://127.0.0.1:8787/sync");
    expect(info.status.state).toBe("connecting");

    service.publish(snapshot);
    await vi.waitFor(() => expect(relay.sent.length).toBeGreaterThanOrEqual(2));

    const wire = relay.sent.map((frame) => new TextDecoder().decode(frame));
    expect(wire[0]).toContain('"type":"join"');
    expect(wire.some((text) => text.includes('"type":"frame"'))).toBe(true);
    // The host carries opaque bytes: not the task title, not a snapshot field.
    expect(wire.some((text) => text.includes("A secret task title"))).toBe(false);
    expect(wire.some((text) => text.includes("scheduledFor"))).toBe(false);
  });
});
