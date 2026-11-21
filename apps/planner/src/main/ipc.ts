import { join } from "node:path";
import { isTrustedSender } from "@suite/desktop";
import { todayKey } from "@suite/planner-core";

import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { z } from "zod";
import { currentChannel } from "./channel";
import { workspaceFolder } from "./paths";
import { pageOrigins } from "./protocol";
import type { PlannerSyncController } from "./sync/ipc";
import { isInFolder } from "./workspaceLocation";
import type { WorkspaceStore } from "./workspaceStore";

const updateSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: "Expected a binary CRDT update",
});

const relayUrlSchema = z
  .string()
  .trim()
  .regex(/^wss?:\/\/\S+$/u, { message: "Expected a ws:// or wss:// relay address" });

const inviteRoleSchema = z.enum(["editor", "viewer"]);

const relayFingerprintSchema = z.string().trim().min(1).optional();

const inviteLinkSchema = z.string().trim().min(1);

/**
 * Register a channel, but only answer the page this app loaded.
 *
 * Electron's checklist asks every handler to validate the sender.
 */
function onIpc(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event.senderFrame?.url, pageOrigins())) return undefined;
    return handler(event, ...args);
  });
}

/**
 * Register the renderer's channels against whatever workspace is open.
 *
 * The getter rather than the store itself: a file handed over by the hub replaces the workspace, and
 * `ipcMain.handle` refuses a second registration for the same channel.
 */
export function registerIpc(getStore: () => WorkspaceStore, sync: PlannerSyncController): void {
  onIpc("workspace:snapshot", () => getStore().snapshot());

  onIpc("workspace:commit", (_event, payload: unknown) => {
    const update = updateSchema.parse(payload);
    getStore().commit(update);
    // The same delta a local edit produced is what a relay carries later. Publishing is
    // ordered inside the service, so a quick second edit cannot race the first seal.
    sync.publish(update);
  });

  onIpc("workspace:created", () => getStore().created);

  onIpc("workspace:info", () => ({
    path: getStore().path,
    schemaVersion: getStore().document.getMeta().schemaVersion,
  }));

  onIpc("workspace:export", async (event) => {
    const channel = currentChannel();
    const options = {
      title: "Export workspace",
      defaultPath:
        channel === "slop"
          ? join(workspaceFolder(channel), `planner-slop-${todayKey()}.planner`)
          : join(app.getPath("documents"), `planner-${todayKey()}.planner`),
      filters: [{ name: "Suite Planner workspace", extensions: ["planner"] }],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    if (channel === "slop" && isInFolder(result.filePath, workspaceFolder("stable"))) {
      // An export is the one write a person explicitly asks for. It still may not land on a stable
      // document, because a pre-release build does not own that folder.
      dialog.showErrorBox(
        "Export workspace",
        "A pre-release build cannot write into the stable workspace folder. Choose another folder.",
      );
      return { canceled: true };
    }
    await getStore().exportTo(result.filePath);
    return { canceled: false, path: result.filePath };
  });

  onIpc("workspace:import", async (event) => {
    const options: OpenDialogOptions = {
      title: "Import workspace",
      properties: ["openFile"],
      filters: [{ name: "Suite Planner workspace", extensions: ["planner"] }],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { canceled: true };

    await getStore().importFrom(filePath);
    // An imported file may carry a different workspace id, which names a different relay
    // room. Drop the old connection before the window is told what it is holding now.
    await sync.workspaceChanged();
    const snapshot = getStore().snapshot();
    for (const openWindow of BrowserWindow.getAllWindows()) {
      openWindow.webContents.send("workspace:replaced", snapshot);
    }
    return { canceled: false };
  });

  onIpc("app:platform", () => process.platform);

  // Sync: the renderer asks for state and hands over a link; it never holds a key and never
  // opens a socket. Every payload is parsed here before it reaches the service.
  onIpc("sync:status", () => sync.status());

  onIpc("sync:enable", (_event, url: unknown, fingerprint: unknown) =>
    sync.enable(relayUrlSchema.parse(url), relayFingerprintSchema.parse(fingerprint)),
  );

  onIpc("sync:disable", () => sync.disable());

  onIpc("sync:invite", (_event, role: unknown) => sync.invite(inviteRoleSchema.parse(role)));

  onIpc("sync:join", (_event, link: unknown, fingerprint: unknown) =>
    sync.join(inviteLinkSchema.parse(link), relayFingerprintSchema.parse(fingerprint)),
  );
}
