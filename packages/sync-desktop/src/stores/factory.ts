import { type ContactsStore, createContactsStore } from "./contacts.js";
import { createCursorStore, type CursorStore } from "./cursor.js";
import { createGroupStore, type GroupStore } from "./group.js";
import { createPendingStore, type PendingStore } from "./pending.js";
import type { SyncStoreFiles } from "./port.js";
import { createRelayConfigStore, type RelayConfigStore } from "./relayConfig.js";

/**
 * Every store one app keeps for one workspace, over any byte port.
 *
 * The app injects the port and its own root; the layout is the same one both desktop apps
 * already use (`sync/groups`, `sync/relays`, `sync/cursors`, `sync/pending`,
 * `sync/contacts.json`), so an existing workspace opens exactly where it did before. Contacts
 * stay in the app's own root: sharing the mechanics is not sharing the trust decision.
 *
 * This module imports no `node:` module. The Electron hosts add `createSyncStores` next door.
 */
export interface SyncStores {
  readonly group: GroupStore;
  readonly relay: RelayConfigStore;
  readonly cursor: CursorStore;
  readonly pending: PendingStore;
  readonly contacts: ContactsStore;
}

export function createSyncStoresFor(files: SyncStoreFiles, workspaceId: string): SyncStores {
  return {
    group: createGroupStore(files, workspaceId),
    relay: createRelayConfigStore(files, workspaceId),
    cursor: createCursorStore(files, workspaceId),
    pending: createPendingStore(files, workspaceId),
    contacts: createContactsStore(files),
  };
}
