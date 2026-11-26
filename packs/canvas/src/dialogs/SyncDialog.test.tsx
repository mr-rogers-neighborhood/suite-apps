import { deriveFriendCode, formatFriendCode, formatFriendLink } from "@suite/sync";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { SyncDialog } from "./SyncDialog";

const workspaceId = "a".repeat(64);
const installKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const friendCode = deriveFriendCode(installKey);
const friendLink = formatFriendLink({ code: friendCode, publicKey: installKey });
const thisDevice = { deviceId: "b".repeat(64), name: "this laptop", role: "owner" } as const;
const otherDevice = { deviceId: "c".repeat(64), name: "the desktop", role: "editor" } as const;

function open(options: {
  status: Parameters<typeof structuredClone>[0];
  members?: readonly unknown[];
  contacts?: readonly unknown[];
  kit?: "made" | "declined" | null;
  friendLink?: string;
  relayUrl?: string | null;
  sinceOpened?: {
    openedAt: string;
    updates: number;
    lastSyncedAt: string | null;
  } | null;
}) {
  useCanvasStore.setState({
    // The dialog draws from the one snapshot main pushes, so a test sets that and nothing else.
    sync: {
      workspaceId,
      deviceId: thisDevice.deviceId,
      status: options.status as never,
      members: (options.members ?? []) as never,
      friendCode,
      friendLink: options.friendLink ?? "",
      contacts: (options.contacts ?? []) as never,
      relayUrl: options.relayUrl ?? null,
      kit: options.kit ?? null,
      sinceOpened: options.sinceOpened ?? null,
    },
  });
  return render(<SyncDialog open onClose={vi.fn()} />);
}

afterEach(() => {
  cleanup();
  useCanvasStore.setState({ sync: null });
  vi.restoreAllMocks();
});

describe("the sync dialog", () => {
  it("offers the two errands when nobody else has a copy", () => {
    open({ status: { state: "off" } });
    expect(screen.getByTestId("sync-dialog")).toHaveAttribute("data-face", "local");
    expect(screen.getByText("Share this workspace")).toBeInTheDocument();
    expect(screen.getByText("Join one somebody shared")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });

  it("shares the workspace at the address somebody typed", async () => {
    const enableSync = vi.fn(async () => {});
    useCanvasStore.setState({ enableSync });
    open({ status: { state: "off" } });

    fireEvent.change(screen.getByLabelText(/this machine/i), {
      target: { value: "ws://192.168.1.9:8787/sync" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(enableSync).toHaveBeenCalledWith("ws://192.168.1.9:8787/sync");
  });

  it("joins from a pasted invitation", async () => {
    const joinWorkspace = vi.fn(async () => {});
    useCanvasStore.setState({ joinWorkspace });
    open({ status: { state: "off" } });

    fireEvent.change(screen.getByLabelText(/Paste the invitation/), {
      target: { value: "suite://join?h=x&w=y&i=z" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(joinWorkspace).toHaveBeenCalledWith("suite://join?h=x&w=y&i=z");
  });

  it("asks for the certificate fingerprint on a wss relay and hands it to main", async () => {
    const enableSync = vi.fn(async () => {});
    useCanvasStore.setState({ enableSync });
    open({ status: { state: "off" } });

    fireEvent.change(screen.getByLabelText(/this machine/i), {
      target: { value: "wss://192.168.1.9:8787/sync" },
    });
    fireEvent.change(screen.getByLabelText("Relay certificate fingerprint"), {
      target: { value: "AB:CD:EF" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(enableSync).toHaveBeenCalledWith("wss://192.168.1.9:8787/sync", "AB:CD:EF");
  });

  it("shows the certificate it pinned while shared", () => {
    useCanvasStore.setState({
      sync: {
        workspaceId,
        deviceId: thisDevice.deviceId,
        status: { state: "syncing", count: 1 },
        members: [thisDevice],
        friendCode,
        contacts: [],
        kit: null,
        fingerprint: "AB:CD:EF",
      },
    });
    render(<SyncDialog open onClose={vi.fn()} />);

    expect(screen.getByTestId("sync-fingerprint-pinned")).toHaveTextContent("AB:CD:EF");
  });

  it("shows the relay address it is syncing through", () => {
    open({
      status: { state: "syncing", count: 1 },
      members: [thisDevice],
      relayUrl: "ws://127.0.0.1:8787/sync",
    });

    expect(screen.getByTestId("sync-relay-url")).toHaveTextContent("ws://127.0.0.1:8787/sync");
  });

  it("says only that it is waiting, and keeps saying it when reopened", () => {
    open({ status: { state: "waiting" }, members: [] });
    expect(screen.getByTestId("sync-dialog")).toHaveAttribute("data-face", "waiting");
    expect(screen.getByText(/has to let this device in/)).toBeInTheDocument();
    // No invitation while waiting: there is nothing this device may do until it is in.
    expect(screen.queryByText("Invite someone")).toBeNull();
  });

  it("lists the devices here with what each may do", () => {
    open({ status: { state: "syncing", count: 4 }, members: [thisDevice, otherDevice] });
    expect(screen.getByTestId("sync-dialog")).toHaveAttribute("data-face", "synced");
    const list = screen.getByTestId("sync-members");
    expect(list).toHaveTextContent("this laptop (this device)");
    expect(list).toHaveTextContent("in charge");
    expect(list).toHaveTextContent("the desktop");
    expect(list).toHaveTextContent("can edit");
    // The id a host pins is beside the name a person weighs.
    expect(list).toHaveTextContent(`${otherDevice.deviceId.slice(0, 12)}…`);
    expect(screen.getByTitle(otherDevice.deviceId)).toBeInTheDocument();
  });

  it("says what arrived since the workspace was last opened", () => {
    open({
      status: { state: "syncing", count: 4 },
      members: [thisDevice, otherDevice],
      sinceOpened: {
        openedAt: "2026-11-20T08:00:00.000Z",
        updates: 4,
        lastSyncedAt: new Date().toISOString(),
      },
    });

    const card = screen.getByTestId("sync-since-opened");
    expect(card).toHaveTextContent("4 updates arrived from the host");
    expect(card).toHaveTextContent("Other devices here: the desktop");
    expect(card).toHaveTextContent("Last synced just now");
  });

  it("says nothing new when the count is zero, and still says when it last synced", () => {
    open({
      status: { state: "syncing", count: 4 },
      members: [thisDevice],
      sinceOpened: {
        openedAt: "2026-11-20T08:00:00.000Z",
        updates: 0,
        lastSyncedAt: "2026-11-20T08:00:00.000Z",
      },
    });

    const card = screen.getByTestId("sync-since-opened");
    expect(card).toHaveTextContent("Nothing new has arrived on this device yet");
    expect(card).toHaveTextContent("No other device is listed right now");
    expect(card).toHaveTextContent("Last synced");
  });

  it("does not offer Remove to an editor, and says who can", () => {
    const editor = { deviceId: thisDevice.deviceId, name: "this laptop", role: "editor" } as const;
    open({ status: { state: "syncing", count: 2 }, members: [editor, otherDevice] });

    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByText("Only the owner can remove a device.")).toBeInTheDocument();
  });

  it("shows when a stopped workspace last synced", () => {
    open({
      status: { state: "off" },
      sinceOpened: {
        openedAt: "2026-11-20T08:00:00.000Z",
        updates: 0,
        lastSyncedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
    });

    expect(screen.getByTestId("sync-last-synced")).toHaveTextContent("Last synced 3 h ago");
  });

  it("hands back an invitation to give someone", async () => {
    const inviteSomeone = vi.fn(
      async () => "suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync&w=a&i=b",
    );
    useCanvasStore.setState({ inviteSomeone });
    open({ status: { state: "syncing", count: 4 }, members: [thisDevice] });

    fireEvent.click(screen.getByRole("button", { name: "Make one" }));
    expect(await screen.findByText(/suite:\/\/join\?/)).toBeInTheDocument();
    expect(inviteSomeone).toHaveBeenCalledWith("editor");
  });

  it("asks for a way back in once, right after the workspace is shared", async () => {
    const exportKit = vi.fn(async () => "/home/me/way-back-in.json");
    useCanvasStore.setState({ exportKit });
    open({ status: { state: "syncing", count: 1 }, members: [thisDevice] });

    fireEvent.click(screen.getByRole("button", { name: "Save it" }));
    expect(screen.getByTestId("sync-dialog")).toHaveAttribute("data-face", "kit");

    fireEvent.click(screen.getByRole("button", { name: "Save the file" }));
    await waitFor(() => expect(exportKit).toHaveBeenCalledWith(null));
    // The offer is answered, so the dialog goes back to the devices.
    await waitFor(() =>
      expect(screen.getByTestId("sync-dialog")).toHaveAttribute("data-face", "synced"),
    );
  });

  it("seals the file when a passphrase is typed", async () => {
    const exportKit = vi.fn(async () => "/home/me/way-back-in.json");
    useCanvasStore.setState({ exportKit });
    open({ status: { state: "syncing", count: 1 }, members: [thisDevice] });

    fireEvent.click(screen.getByRole("button", { name: "Save it" }));
    fireEvent.change(screen.getByLabelText(/Add a passphrase/), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the file" }));

    await waitFor(() => expect(exportKit).toHaveBeenCalledWith("correct horse"));
  });

  it("stops offering once somebody declined", () => {
    open({ status: { state: "syncing", count: 1 }, members: [thisDevice], kit: "declined" });
    expect(screen.queryByRole("button", { name: "Save it" })).toBeNull();
  });

  it("removes a device, and says what went wrong when it could not", async () => {
    const removeDevice = vi.fn(async () => "That device is not in this workspace.");
    useCanvasStore.setState({ removeDevice });
    open({ status: { state: "syncing", count: 1 }, members: [thisDevice, otherDevice] });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(removeDevice).toHaveBeenCalledWith(otherDevice.deviceId));
    expect(await screen.findByTestId("sync-problem")).toHaveTextContent("not in this workspace");
  });

  it("opens a sealed recovery file by asking for the word", async () => {
    const importKit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "passphrase", path: "/home/me/kit.json" })
      .mockResolvedValueOnce({ ok: true });
    useCanvasStore.setState({ importKit });
    open({ status: { state: "off" } });

    fireEvent.click(screen.getByRole("button", { name: /I have a recovery file/ }));
    await waitFor(() =>
      expect(screen.getByTestId("sync-dialog")).toHaveAttribute("data-face", "unlock"),
    );

    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(importKit).toHaveBeenLastCalledWith({
        path: "/home/me/kit.json",
        passphrase: "correct horse",
      }),
    );
  });

  it("says what to do when an invitation cannot be made", async () => {
    useCanvasStore.setState({ inviteSomeone: vi.fn(async () => null) });
    open({ status: { state: "syncing", count: 4 }, members: [thisDevice] });

    fireEvent.click(screen.getByRole("button", { name: "Make one" }));
    expect(await screen.findByTestId("sync-problem")).toHaveTextContent(
      "no invitation was written",
    );
  });

  it("shows this installation's friend code and adds a person by code", async () => {
    const addContact = vi.fn(async () => undefined);
    useCanvasStore.setState({ addContact });
    open({ status: { state: "off" } });

    expect(screen.getByTestId("friend-code")).toHaveTextContent(formatFriendCode(friendCode));
    fireEvent.change(screen.getByLabelText("Friend code or link"), {
      target: { value: friendCode },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addContact).toHaveBeenCalledWith({ code: friendCode, name: "Ada" });
  });

  it("shows the friend link beside the code and draws a QR of that same link", () => {
    open({ status: { state: "off" }, friendLink });

    expect(screen.getByTestId("friend-link")).toHaveTextContent(friendLink);
    expect(screen.getByTestId("friend-qr")).toHaveAttribute("data-payload", friendLink);
  });

  it("adds a person from a pasted friend link, key and all", async () => {
    const addContact = vi.fn(async () => undefined);
    useCanvasStore.setState({ addContact });
    open({ status: { state: "off" } });

    fireEvent.change(screen.getByLabelText("Friend code or link"), {
      target: { value: friendLink },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addContact).toHaveBeenCalledWith({
        code: friendCode,
        name: "Ada",
        publicKey: installKey,
      }),
    );
  });

  it("refuses a malformed friend link with the message a malformed code gets", async () => {
    const addContact = vi.fn(async () => undefined);
    useCanvasStore.setState({ addContact });
    open({ status: { state: "off" } });

    fireEvent.change(screen.getByLabelText("Friend code or link"), {
      target: { value: "suite://friend?c=ABC" },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByTestId("sync-problem")).toHaveTextContent(
      "A friend code is 16 symbols.",
    );
    expect(addContact).not.toHaveBeenCalled();
  });

  it("forgets a person without touching the workspace", async () => {
    const forgetContact = vi.fn(async () => undefined);
    useCanvasStore.setState({ forgetContact });
    open({
      status: { state: "off" },
      contacts: [
        { code: friendCode, name: "Ada", addedAt: "2026-01-01T00:00:00.000Z", trusted: true },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));

    expect(forgetContact).toHaveBeenCalledWith(friendCode);
  });
});
