import type { WebContents } from "electron";
import type { PackInfo } from "./packs.js";

/**
 * Which pack and tab a renderer belongs to.
 *
 * The host never trusts a pack to say who it is. The mapping is written when the
 * view is created, from the main process, and every document or file call is
 * scoped by the pack id found here. A renderer with no entry gets nothing.
 *
 * `webContents` is the host's handle to that renderer. A declared projection is
 * run in the pack's own page, so the sender carries the handle rather than the
 * handler hunting for it by id.
 */
export interface PackSender {
  readonly containerId: string;
  readonly packId: string;
  readonly tabId: string;
  readonly pack: PackInfo;
  readonly webContentsId: number;
  readonly webContents: WebContents;
}

const senders = new Map<number, PackSender>();

export function setPackSender(webContentsId: number, sender: PackSender): void {
  senders.set(webContentsId, sender);
}

export function packSender(webContentsId: number): PackSender | undefined {
  return senders.get(webContentsId);
}

export function clearPackSender(webContentsId: number): void {
  senders.delete(webContentsId);
}
