import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  addContact as addToBook,
  contactsFileSchema,
  learnContact,
  type NewContact,
  removeContact as removeFromBook,
  type SyncContact,
} from "@suite/sync";

/**
 * The people an installation knows, kept beside the workspace in that app's data directory.
 *
 * A contacts file is app data, not a document field and not a relay record: it never travels
 * with the workspace file and the relay never sees it. It is mode 0600 and written with the
 * same temp-file rename as every other file the shell keeps, so a crash leaves either the old
 * list or the new one.
 *
 * The file stays per app even though the mechanics are shared: the app passes its own
 * directory, so Canvas and Planner can each make their own trust decision. Nothing here
 * decides whether an invitation is acceptable — `resolveFriendInvite` stays in the app.
 *
 * A file this build cannot read is treated as empty rather than crashing the app. The
 * original is left alone, so a newer build can still recover it.
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

export function createContactsStore({ dataDir }: { readonly dataDir: string }): ContactsStore {
  const directory = join(dataDir, "sync");
  const target = join(directory, "contacts.json");

  async function saveContacts(contacts: readonly SyncContact[]): Promise<void> {
    await mkdir(directory, { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, contacts }, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, target);
  }

  return {
    async load() {
      try {
        const parsed = contactsFileSchema.safeParse(JSON.parse(await readFile(target, "utf8")));
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
