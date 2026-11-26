import {
  addContact as addToBook,
  contactsFileSchema,
  learnContact,
  type NewContact,
  removeContact as removeFromBook,
  type SyncContact,
} from "@suite/sync";

import { decodeStoreText, encodeStoreText, SYNC_STORE_ROOT, type SyncStoreFiles } from "./port.js";

/**
 * The people an installation knows, kept beside the workspace in that app's root.
 *
 * A contacts file is app data, not a document field and not a relay record: it never travels
 * with the workspace file and the relay never sees it. The port writes it with the same
 * temporary-file rule as every other file, so a crash leaves either the old list or the new
 * one.
 *
 * The file stays per app even though the mechanics are shared: the app passes its own root, so
 * Canvas and Planner can each make their own trust decision. Nothing here decides whether an
 * invitation is acceptable — `resolveFriendInvite` stays in the app.
 *
 * A file this build cannot read is treated as empty rather than crashing the app. The original
 * is left alone, so a newer build can still recover it.
 */
export interface ContactsStore {
  load(): Promise<readonly SyncContact[]>;
  remember(contacts: readonly SyncContact[], input: NewContact): Promise<readonly SyncContact[]>;
  forget(contacts: readonly SyncContact[], code: string): Promise<readonly SyncContact[]>;
  noteSeen(
    contacts: readonly SyncContact[],
    invite: Parameters<typeof learnContact>[1],
    now?: Date,
  ): Promise<readonly SyncContact[]>;
}

export function createContactsStore(files: SyncStoreFiles): ContactsStore {
  const target = `${SYNC_STORE_ROOT}/contacts.json`;

  async function saveContacts(contacts: readonly SyncContact[]): Promise<void> {
    await files.write(
      target,
      encodeStoreText(`${JSON.stringify({ version: 1, contacts }, null, 2)}\n`),
    );
  }

  return {
    async load() {
      const bytes = await files.read(target);
      if (bytes === null) return [];
      try {
        const parsed = contactsFileSchema.safeParse(JSON.parse(decodeStoreText(bytes)));
        return parsed.success ? parsed.data.contacts : [];
      } catch {
        return [];
      }
    },

    /** Add or complete a contact, and hand back the list that was written. */
    async remember(contacts, input) {
      const next = addToBook(contacts, input);
      await saveContacts(next);
      return next;
    },

    async forget(contacts, code) {
      const next = removeFromBook(contacts, code);
      await saveContacts(next);
      return next;
    },

    /** Record what a verified invitation taught us about a contact, if the code is known. */
    async noteSeen(contacts, invite, now = new Date()) {
      const next = learnContact(contacts, invite, now);
      await saveContacts(next);
      return next;
    },
  };
}
