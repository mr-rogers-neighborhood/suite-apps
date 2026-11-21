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
 * The people this installation knows, kept beside the workspace.
 *
 * A contacts file is app data, not a document field and not a relay record: it never
 * travels with the `.planner` file and the relay never sees it. It is mode 0600 and
 * written with the same temp-file rename as every other file this app keeps, so a crash
 * leaves either the old list or the new one.
 *
 * A file this build cannot read is treated as empty rather than crashing the app. The
 * original is left alone, so a newer build can still recover it.
 */
const CONTACTS_FILE = "contacts.json";

export async function loadContacts(dataDir: string): Promise<readonly SyncContact[]> {
  try {
    const parsed = contactsFileSchema.safeParse(
      JSON.parse(await readFile(pathFor(dataDir), "utf8")),
    );
    return parsed.success ? parsed.data.contacts : [];
  } catch {
    return [];
  }
}

async function saveContacts(dataDir: string, contacts: readonly SyncContact[]): Promise<void> {
  const directory = join(dataDir, "sync");
  await mkdir(directory, { recursive: true });
  const target = pathFor(dataDir);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, contacts }, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, target);
}

/** Add or complete a contact, and hand back the list that was written. */
export async function rememberContact(
  dataDir: string,
  contacts: readonly SyncContact[],
  input: NewContact,
): Promise<readonly SyncContact[]> {
  const next = addToBook(contacts, input);
  await saveContacts(dataDir, next);
  return next;
}

export async function forgetContact(
  dataDir: string,
  contacts: readonly SyncContact[],
  code: string,
): Promise<readonly SyncContact[]> {
  const next = removeFromBook(contacts, code);
  await saveContacts(dataDir, next);
  return next;
}

/** Record what a verified invitation taught us about a contact, if the code is known. */
export async function noteSeen(
  dataDir: string,
  contacts: readonly SyncContact[],
  invite: Parameters<typeof learnContact>[1],
  now: Date = new Date(),
): Promise<readonly SyncContact[]> {
  const next = learnContact(contacts, invite, now);
  await saveContacts(dataDir, next);
  return next;
}

function pathFor(dataDir: string): string {
  return join(dataDir, "sync", CONTACTS_FILE);
}
