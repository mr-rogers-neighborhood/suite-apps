import { type DeviceGroup, decodeGroup, encodeGroup } from "@suite/sync";

import { encodeStoreText, SYNC_STORE_ROOT, type SyncStoreFiles } from "./port.js";

/**
 * A device's MLS group state, per workspace, on disk beside the workspace.
 *
 * Losing this file is losing the ability to read the workspace: the group secret it holds
 * cannot be derived again from anything else this app has. The port writes it through a
 * temporary file — a half-written group is not a group — and replaces by a rename so a crash
 * leaves the previous one intact.
 */
export interface GroupStore {
  load(): Promise<DeviceGroup | null>;
  save(group: DeviceGroup): Promise<void>;
  /** Whether this device started the group, rather than being added to it. */
  isOwned(): Promise<boolean>;
  markOwned(): Promise<void>;
}

export function createGroupStore(files: SyncStoreFiles, workspaceId: string): GroupStore {
  const target = `${SYNC_STORE_ROOT}/groups/${workspaceId}.mls`;
  const marker = `${SYNC_STORE_ROOT}/groups/${workspaceId}.owner`;

  return {
    async load() {
      const bytes = await files.read(target);
      if (bytes === null) return null;
      try {
        return decodeGroup(bytes);
      } catch {
        return null;
      }
    },

    async save(group) {
      await files.write(target, encodeGroup(group));
    },

    /**
     * It decides one thing: who may claim ownership when the relay has no owner on record.
     *
     * A device that was let in must never be able to make that claim, whatever the relay has
     * forgotten, so the answer is written once at creation and read back from disk.
     */
    async isOwned() {
      return (await files.read(marker)) !== null;
    },

    async markOwned() {
      await files.write(marker, encodeStoreText("owned\n"));
    },
  };
}
