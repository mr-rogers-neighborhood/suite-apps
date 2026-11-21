import { type ContactsStore, createContactsStore } from "./contacts.js";
import { type CursorStore, createCursorStore } from "./cursor.js";
import { createGroupStore, type GroupStore } from "./group.js";
import { createPendingStore, type PendingStore } from "./pending.js";
import {
  createRelayConfigStore,
  type RelayConfigStore,
  type SyncStorePaths,
} from "./relayConfig.js";

/**
 * Every store one app keeps for one workspace, rooted at that app's own data directory.
 *
 * The app injects the directory; the layout under it is the same one both desktop apps
 * already use (`sync/groups`, `sync/relays`, `sync/cursors`, `sync/pending`, `sync/contacts.json`),
 * so an existing workspace opens exactly where it did before. Contacts stay in the app's own
 * directory: sharing the mechanics is not sharing the trust decision.
 */
export interface SyncStores {
  readonly group: GroupStore;
  readonly relay: RelayConfigStore;
  readonly cursor: CursorStore;
  readonly pending: PendingStore;
  readonly contacts: ContactsStore;
}

export function createSyncStores(paths: SyncStorePaths): SyncStores {
  return {
    group: createGroupStore(paths),
    relay: createRelayConfigStore(paths),
    cursor: createCursorStore(paths),
    pending: createPendingStore(paths),
    contacts: createContactsStore({ dataDir: paths.dataDir }),
  };
}
