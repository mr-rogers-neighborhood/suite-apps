import type { SyncInfo } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  onSyncChanged: vi.fn((_listener: (info: SyncInfo) => void) => () => undefined),
  syncStatus: vi.fn(),
  syncEnable: vi.fn(),
  syncDisable: vi.fn(),
  syncInvite: vi.fn(),
  syncJoin: vi.fn(),
}));

vi.mock("../platform/bridge", () => ({ getBridge: () => bridge }));

const { SyncControl } = await import("./SyncControl");

const local: SyncInfo = {
  workspaceId: "a".repeat(64),
  deviceId: "d".repeat(64),
  status: { state: "off" },
  members: [],
};

const synced: SyncInfo = {
  ...local,
  status: { state: "syncing", count: 3 },
  members: [
    { deviceId: "d".repeat(64), name: "Planner on this laptop", role: "owner" },
    { deviceId: "e".repeat(64), name: "Planner on the desktop", role: "editor" },
  ],
};

beforeEach(() => {
  bridge.syncStatus.mockReset().mockResolvedValue(local);
  bridge.syncEnable
    .mockReset()
    .mockResolvedValue({ ...local, status: { state: "syncing", count: 1 } });
  bridge.syncDisable.mockReset().mockResolvedValue(local);
  bridge.syncInvite.mockReset();
  bridge.syncJoin.mockReset().mockResolvedValue({ ...local, status: { state: "waiting" } });
});

afterEach(cleanup);

describe("SyncControl", () => {
  it("should say the workspace is local and share it at the address in the field", async () => {
    render(<SyncControl />);

    const pill = await screen.findByTestId("sync-status");
    expect(pill).toHaveTextContent("Local only");

    fireEvent.click(pill);
    fireEvent.click(screen.getByRole("button", { name: "Share this workspace" }));

    expect(bridge.syncEnable).toHaveBeenCalledWith("ws://127.0.0.1:8787/sync");
  });

  it("should name the devices and write an invitation somebody can send", async () => {
    bridge.syncStatus.mockResolvedValue(synced);
    bridge.syncInvite.mockResolvedValue("suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync");

    render(<SyncControl />);
    fireEvent.click(await screen.findByTestId("sync-status"));

    expect(await screen.findByText("Planner on the desktop")).toBeInTheDocument();
    expect(screen.getByText(/this device/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Make an invitation" }));

    expect(bridge.syncInvite).toHaveBeenCalledWith("editor");
    expect(
      await screen.findByDisplayValue("suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync"),
    ).toBeInTheDocument();
  });

  it("should hand a pasted invitation to main and stop syncing on leave", async () => {
    render(<SyncControl />);
    fireEvent.click(await screen.findByTestId("sync-status"));

    fireEvent.change(screen.getByLabelText("Join with an invitation"), {
      target: { value: "suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync&w=x&i=y" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(bridge.syncJoin).toHaveBeenCalledWith(
      "suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync&w=x&i=y",
    );

    bridge.syncStatus.mockResolvedValue(synced);
    cleanup();
    render(<SyncControl />);
    fireEvent.click(await screen.findByTestId("sync-status"));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    expect(bridge.syncDisable).toHaveBeenCalled();
  });

  it("should ask for the certificate fingerprint on a wss relay", async () => {
    render(<SyncControl />);
    fireEvent.click(await screen.findByTestId("sync-status"));

    fireEvent.change(screen.getByLabelText("Relay address"), {
      target: { value: "wss://192.168.1.9:8787/sync" },
    });
    fireEvent.change(screen.getByLabelText("Relay certificate fingerprint"), {
      target: { value: "AB:CD:EF" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Share this workspace" }));

    expect(bridge.syncEnable).toHaveBeenCalledWith("wss://192.168.1.9:8787/sync", "AB:CD:EF");
  });
});
