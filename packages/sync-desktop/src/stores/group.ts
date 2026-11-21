import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type DeviceGroup, decodeGroup, encodeGroup } from "@suite/sync";

import type { SyncStorePaths } from "./relayConfig.js";

/**
 * A device's MLS group state, per workspace, on disk beside the workspace.
 *
 * Losing this file is losing the ability to read the workspace: the group secret it holds
 * cannot be derived again from anything else this app has. It is written through a temporary
 * file — a half-written group is not a group — and replaced by a rename so a crash leaves
 * the previous one intact.
 */
export interface GroupStore {
  load(): Promise<DeviceGroup | null>;
  save(group: DeviceGroup): Promise<void>;
  /** Whether this device started the group, rather than being added to it. */
  isOwned(): Promise<boolean>;
  markOwned(): Promise<void>;
}

export function createGroupStore({ dataDir, workspaceId }: SyncStorePaths): GroupStore {
  const directory = join(dataDir, "sync", "groups");
  const target = join(directory, `${workspaceId}.mls`);
  const marker = join(directory, `${workspaceId}.owner`);

  return {
    async load() {
      try {
        return decodeGroup(new Uint8Array(await readFile(target)));
      } catch {
        return null;
      }
    },

    async save(group) {
      await mkdir(directory, { recursive: true });
      const temporary = `${target}.tmp`;
      await writeFile(temporary, encodeGroup(group), { mode: 0o600 });
      await rename(temporary, target);
    },

    /**
     * It decides one thing: who may claim ownership when the relay has no owner on record.
     *
     * A device that was let in must never be able to make that claim, whatever the relay has
     * forgotten, so the answer is written once at creation and read back from disk.
     */
    async isOwned() {
      try {
        await readFile(marker);
        return true;
      } catch {
        return false;
      }
    },

    async markOwned() {
      await mkdir(directory, { recursive: true });
      await writeFile(marker, "owned\n", { mode: 0o600 });
    },
  };
}
