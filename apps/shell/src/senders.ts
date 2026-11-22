import type { PackInfo } from "./packs.js";

/**
 * Which pack and tab a renderer belongs to.
 *
 * The host never trusts a pack to say who it is. The mapping is written when the
 * view is created, from the main process, and every document or file call is
 * scoped by the pack id found here. A renderer with no entry gets nothing.
 */
export interface PackSender {
  readonly containerId: string;
  readonly packId: string;
  readonly tabId: string;
  readonly pack: PackInfo;
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
