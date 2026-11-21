import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC, type KitImportResult } from "../../shared/ipc.js";

const { createSyncService } = vi.hoisted(() => ({ createSyncService: vi.fn() }));

vi.mock("./service.js", () => ({ createSyncService }));
vi.mock("./hubAddress.js", () => ({
  readHub: async () => ({ running: false, address: null, scope: "loopback" }),
}));

import { registerSyncIpc, type SyncIpcOptions } from "./ipc.js";

type Handler = Parameters<SyncIpcOptions["onIpc"]>[1];

const dataDir = "/tmp/suite-canvas-kit-ipc-test";

function fakeService() {
  const importKit = vi.fn(async () => undefined);
  const service = {
    connect: vi.fn(async () => ({ state: "off" as const })),
    disconnect: vi.fn(async () => undefined),
    status: vi.fn(() => ({ state: "off" as const })),
    identity: vi.fn(async () => ({ deviceId: "d".repeat(64), publicKey: "key" })),
    publish: vi.fn(async () => undefined),
    createInvite: vi.fn(async () => "suite://join?invite=one"),
    join: vi.fn(async () => ({ state: "off" as const })),
    resume: vi.fn(async () => ({ state: "off" as const })),
    members: vi.fn(() => []),
    presence: vi.fn(async () => undefined),
    onPresence: vi.fn(),
    removeDevice: vi.fn(async () => undefined),
    exportKit: vi.fn(async () => new Uint8Array()),
    importKit,
    noteKit: vi.fn(async () => undefined),
    onMembers: vi.fn(),
    onJoinedByAnother: vi.fn(),
    onUpdate: vi.fn(),
    onStatus: vi.fn(),
  };
  return { service, importKit };
}

function harness() {
  const { service, importKit } = fakeService();
  createSyncService.mockResolvedValue(service);

  const handlers = new Map<string, Handler>();
  const kitFiles = {
    pickSavePath: vi.fn(async () => null),
    pickOpenPath: vi.fn(async (): Promise<string | null> => null),
    writeBytes: vi.fn(async () => undefined),
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };

  registerSyncIpc({
    dataDir,
    currentWorkspaceId: () => "workspace",
    webContents: () => null,
    deviceName: "Canvas on test",
    kitFiles,
    onIpc: (channel, handler) => {
      handlers.set(channel, handler);
    },
  });

  const importKitOverIpc = (request: unknown): Promise<KitImportResult> => {
    const handler = handlers.get(IPC.syncImportKit);
    if (handler === undefined) throw new Error("the import-kit handler was not registered");
    return handler(undefined as never, request) as Promise<KitImportResult>;
  };

  return { importKitOverIpc, kitFiles, importKit };
}

describe("importing a recovery kit over IPC", () => {
  beforeEach(() => {
    createSyncService.mockReset();
  });

  it("ignores a renderer-supplied path this shell never produced", async () => {
    const { importKitOverIpc, kitFiles, importKit } = harness();
    kitFiles.pickOpenPath.mockResolvedValueOnce(null);

    const result = await importKitOverIpc({ path: "/tmp/never-picked.json" });

    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(kitFiles.pickOpenPath).toHaveBeenCalledTimes(1);
    expect(kitFiles.readBytes).not.toHaveBeenCalled();
    expect(importKit).not.toHaveBeenCalled();
  });

  it("opens the picker and reads the path the picker produced", async () => {
    const { importKitOverIpc, kitFiles, importKit } = harness();
    kitFiles.pickOpenPath.mockResolvedValueOnce("/tmp/picked.json");

    const result = await importKitOverIpc({ path: "/tmp/never-picked.json" });

    expect(result).toMatchObject({ ok: true });
    expect(kitFiles.readBytes).toHaveBeenCalledWith("/tmp/picked.json");
    expect(importKit).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), null);
  });

  it("keeps the passphrase retry, which reuses the path the shell handed out", async () => {
    const { importKitOverIpc, kitFiles, importKit } = harness();
    kitFiles.pickOpenPath.mockResolvedValueOnce("/tmp/sealed.json");
    importKit.mockRejectedValueOnce(new Error("That file needs its passphrase."));

    const first = await importKitOverIpc({});

    expect(first).toEqual({ ok: false, reason: "passphrase", path: "/tmp/sealed.json" });

    const second = await importKitOverIpc({
      path: "/tmp/sealed.json",
      passphrase: "correct horse",
    });

    expect(second).toMatchObject({ ok: true });
    // The retry did not ask for the file again; the path came from the shell's own answer.
    expect(kitFiles.pickOpenPath).toHaveBeenCalledTimes(1);
    expect(kitFiles.readBytes).toHaveBeenLastCalledWith("/tmp/sealed.json");
    expect(importKit).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]), "correct horse");
  });
});
