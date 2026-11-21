import type { SuiteSyncMembershipNotice } from "@suite/contracts";
import type { SyncMemberRole, SyncState } from "@suite/planner-core";
import type { RelayMember } from "@suite/sync";
import { describe, expect, it } from "vitest";

import { createPlannerSyncCapability } from "./capability";
import type { PlannerSyncService } from "./service";

const workspaceId = "b".repeat(64);
const deviceId = "a".repeat(64);

/** A service with the same shape the real one has, and no socket. */
function fakeService() {
  const calls = {
    connect: [] as string[],
    publish: [] as Uint8Array[],
    invites: [] as Array<"editor" | "viewer">,
  };
  const updateHandlers: Array<(update: Uint8Array) => void> = [];
  const memberHandlers: Array<() => void> = [];
  let state: SyncState = { state: "off" };
  let roster: RelayMember[] = [];

  const service: PlannerSyncService = {
    async connect(url) {
      calls.connect.push(url);
      state = { state: "syncing", count: 1 };
      return state;
    },
    async disconnect() {
      state = { state: "off" };
    },
    status: () => state,
    identity: async () => ({ deviceId, publicKey: "public-key" }),
    members: () => roster,
    async publish(update) {
      calls.publish.push(update);
    },
    async createInvite(role) {
      calls.invites.push(role);
      if (state.state === "off") throw new Error("Sync is not connected.");
      return "suite://join?invite=one";
    },
    async join(link) {
      if (link === "wrong") throw new Error("That invitation is for another workspace.");
      return { state: "waiting" };
    },
    async resume() {
      return state;
    },
    onUpdate(handler) {
      updateHandlers.push(handler);
    },
    onStatus() {
      // The adapter never subscribes to status; it asks for it.
    },
    onMembers(handler) {
      memberHandlers.push(handler);
    },
    onJoinedByAnother() {
      // Not part of this contract.
    },
    onConnected() {
      // Not part of this contract.
    },
  };

  return {
    service,
    calls,
    setState(next: SyncState) {
      state = next;
    },
    setMembers(next: RelayMember[]) {
      roster = next;
    },
    update(update: Uint8Array) {
      for (const handler of updateHandlers) handler(update);
    },
    membersChanged() {
      for (const handler of memberHandlers) handler();
    },
  };
}

const member = (role: SyncMemberRole = "owner"): RelayMember => ({
  deviceId,
  name: "Aurora's laptop",
  role,
});

describe("the Planner sync capability", () => {
  it("forwards the service status without inventing one", async () => {
    const fake = fakeService();
    const capability = createPlannerSyncCapability({ service: fake.service, workspaceId });

    await expect(capability.status()).resolves.toEqual({ state: "off" });
    fake.setState({ state: "syncing", count: 2 });
    await expect(capability.status()).resolves.toEqual({ state: "syncing", count: 2 });
    fake.setState({ state: "asleep", reason: "the relay is not answering" });
    await expect(capability.status()).resolves.toEqual({
      state: "asleep",
      reason: "the relay is not answering",
    });
  });

  it("enables only its own workspace, and only a relay address", async () => {
    const fake = fakeService();
    const capability = createPlannerSyncCapability({ service: fake.service, workspaceId });

    await expect(
      capability.enable("c".repeat(64), "ws://127.0.0.1:8787/sync"),
    ).rejects.toMatchObject({
      name: "SuiteSyncCapabilityError",
      operation: "enable",
      code: "wrong-workspace",
    });
    await expect(
      capability.enable(workspaceId, "http://127.0.0.1:8787/sync"),
    ).rejects.toMatchObject({
      operation: "enable",
      code: "bad-relay",
    });
    await expect(capability.enable(workspaceId, "ws://127.0.0.1:8787/sync")).resolves.toEqual({
      state: "syncing",
      count: 1,
    });
    expect(fake.calls.connect).toEqual(["ws://127.0.0.1:8787/sync"]);
  });

  it("names an invitation failure by the call, not by the document", async () => {
    const fake = fakeService();
    const capability = createPlannerSyncCapability({ service: fake.service, workspaceId });

    await expect(capability.invite("editor")).rejects.toMatchObject({
      operation: "invite",
      code: "not-connected",
      message: "Sync is not connected.",
    });
    expect(fake.calls.invites).toEqual(["editor"]);

    fake.setState({ state: "syncing", count: 1 });
    await expect(capability.invite("editor")).resolves.toBe("suite://join?invite=one");
    await expect(capability.join("wrong")).rejects.toMatchObject({
      operation: "join",
      code: "wrong-workspace",
    });
  });

  it("carries frames and roster changes to every listener until it unsubscribes", async () => {
    const fake = fakeService();
    const capability = createPlannerSyncCapability({ service: fake.service, workspaceId });
    const frames: Uint8Array[] = [];
    const notices: SuiteSyncMembershipNotice[] = [];

    const stopFrames = capability.onFrame((frame) => frames.push(frame));
    const stopMembers = capability.onMembership((notice) => notices.push(notice));

    fake.setMembers([member()]);
    fake.update(new Uint8Array([1, 2, 3]));
    fake.membersChanged();

    expect(frames).toEqual([new Uint8Array([1, 2, 3])]);
    expect(notices).toEqual([{ change: "roster", members: [member()] }]);
    expect(JSON.stringify(notices)).not.toContain("Quarterly");

    stopFrames();
    stopMembers();
    fake.update(new Uint8Array([4]));
    fake.membersChanged();

    expect(frames).toHaveLength(1);
    expect(notices).toHaveLength(1);
  });

  it("sends through the door the service already has", async () => {
    const fake = fakeService();
    const capability = createPlannerSyncCapability({ service: fake.service, workspaceId });
    const frame = new Uint8Array([9, 8, 7]);

    await capability.send(frame);

    expect(fake.calls.publish).toEqual([frame]);
  });
});
