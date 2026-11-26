import type { FilesService } from "@suite/pack-runtime";
import type { SyncStores } from "@suite/sync-desktop";
import {
  addContact as addToBook,
  contactsFileSchema,
  decodeBase64,
  decodeGroup,
  decodeKeyPackageBytes,
  encodeBase64,
  encodeGroup,
  encodeKeyPackageBytes,
  learnContact,
  type NewContact,
  normaliseFingerprint,
  removeContact as removeFromBook,
  type SyncContact,
} from "@suite/sync";

import type { PendingJoin } from "@suite/sync-desktop";

/**
 * The sync state this pack keeps in its own files root.
 *
 * The layout is the shared desktop one, with one difference that a pack cannot
 * avoid: two workspaces share a pack root, so each workspace gets a directory.
 * A key, a cursor and a pending join therefore live under
 * `sync/workspaces/<workspaceId>/`, while the installation key and the contacts
 * decision live once at `sync/identity.json` and `sync/contacts.json`.
 *
 * Nothing here is a document field, a host key or browser storage. The pack
 * reads and writes only through `FilesService`, and the host's write is atomic,
 * so a crash leaves the previous group or pending join intact.
 */
export interface PackStoreFiles {
  readonly files: FilesService;
  readonly workspaceId: string;
}

function isFilesService(files: Partial<FilesService> | null | undefined): files is FilesService {
  return (
    files !== null &&
    files !== undefined &&
    typeof files.read === "function" &&
    typeof files.write === "function"
  );
}

export function requireSyncFiles(
  files: Partial<FilesService> | null | undefined,
): FilesService {
  if (!isFilesService(files)) {
    throw new Error("This host gives Planner no files root, so sync state cannot be stored.");
  }
  return files;
}

async function readText(files: FilesService, path: string): Promise<string | null> {
  try {
    return new TextDecoder().decode(await files.read(path));
  } catch {
    return null;
  }
}

async function readJson(files: FilesService, path: string): Promise<unknown | null> {
  const text = await readText(files, path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeText(files: FilesService, path: string, text: string): Promise<void> {
  await files.write(path, new TextEncoder().encode(text), { atomic: true });
}

function workspaceDirectory(workspaceId: string): string {
  return `sync/workspaces/${workspaceId}`;
}

/** Contacts are one installation's trust decision, so they sit above the workspaces. */
const CONTACTS_PATH = "sync/contacts.json";

export function createPackSyncStores({ files, workspaceId }: PackStoreFiles): SyncStores {
  const directory = workspaceDirectory(workspaceId);
  const groupPath = `${directory}/group.mls`;
  const ownerPath = `${directory}/group.owner`;
  const relayPath = `${directory}/relay.json`;
  const cursorPath = `${directory}/cursor.json`;
  const pendingPath = `${directory}/pending.json`;

  return {
    group: {
      async load() {
        try {
          const bytes = await files.read(groupPath);
          return decodeGroup(bytes);
        } catch {
          return null;
        }
      },
      async save(group) {
        await files.write(groupPath, encodeGroup(group), { atomic: true });
      },
      async isOwned() {
        return (await readText(files, ownerPath)) !== null;
      },
      async markOwned() {
        await writeText(files, ownerPath, "owned\n");
      },
    },

    relay: {
      async load() {
        const parsed = await readJson(files, relayPath);
        if (typeof parsed !== "object" || parsed === null) return null;
        const record = parsed as { host?: unknown; fingerprint?: unknown };
        if (typeof record.host !== "string" || record.host.length === 0) return null;
        const fingerprint =
          typeof record.fingerprint === "string" ? normaliseFingerprint(record.fingerprint) : null;
        return { host: record.host, fingerprint };
      },
      async save(config) {
        await writeText(
          files,
          relayPath,
          `${JSON.stringify({
            version: 1,
            host: config.host,
            fingerprint: config.fingerprint,
          })}\n`,
        );
      },
    },

    cursor: {
      async load() {
        const parsed = await readJson(files, cursorPath);
        if (typeof parsed !== "object" || parsed === null) return null;
        const index = (parsed as { index?: unknown }).index;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
        return index;
      },
      async save(index) {
        if (!Number.isInteger(index) || index < 0) return;
        await writeText(files, cursorPath, `${JSON.stringify({ version: 1, index })}\n`);
      },
      async clear() {
        await files.remove(cursorPath).catch(() => undefined);
      },
    },

    pending: {
      async load(): Promise<PendingJoin | null> {
        const parsed = await readJson(files, pendingPath);
        if (typeof parsed !== "object" || parsed === null) return null;
        const record = parsed as {
          name?: unknown;
          keyPackage?: unknown;
          host?: unknown;
          private?: {
            initPrivateKey?: unknown;
            hpkePrivateKey?: unknown;
            signaturePrivateKey?: unknown;
          };
        };
        if (typeof record.name !== "string" || typeof record.host !== "string") return null;
        if (typeof record.keyPackage !== "string") return null;

        const keyPackage = decodeBase64(record.keyPackage);
        const initPrivateKey =
          typeof record.private?.initPrivateKey === "string"
            ? decodeBase64(record.private.initPrivateKey)
            : null;
        const hpkePrivateKey =
          typeof record.private?.hpkePrivateKey === "string"
            ? decodeBase64(record.private.hpkePrivateKey)
            : null;
        const signaturePrivateKey =
          typeof record.private?.signaturePrivateKey === "string"
            ? decodeBase64(record.private.signaturePrivateKey)
            : null;
        if (
          keyPackage === null ||
          initPrivateKey === null ||
          hpkePrivateKey === null ||
          signaturePrivateKey === null
        ) {
          return null;
        }
        try {
          return {
            host: record.host,
            identity: {
              name: record.name,
              keyPackage: decodeKeyPackageBytes(keyPackage),
              privateKeys: { initPrivateKey, hpkePrivateKey, signaturePrivateKey },
            },
          };
        } catch {
          return null;
        }
      },
      async save(identity, host) {
        await writeText(
          files,
          pendingPath,
          `${JSON.stringify(
            {
              version: 1,
              name: identity.name,
              keyPackage: encodeBase64(encodeKeyPackageBytes(identity.keyPackage)),
              host,
              private: {
                initPrivateKey: encodeBase64(identity.privateKeys.initPrivateKey),
                hpkePrivateKey: encodeBase64(identity.privateKeys.hpkePrivateKey),
                signaturePrivateKey: encodeBase64(identity.privateKeys.signaturePrivateKey),
              },
            },
            null,
            2,
          )}\n`,
        );
      },
      async clear() {
        await files.remove(pendingPath).catch(() => undefined);
      },
    },

    contacts: {
      async load(): Promise<readonly SyncContact[]> {
        const parsed = contactsFileSchema.safeParse(await readJson(files, CONTACTS_PATH));
        return parsed.success ? parsed.data.contacts : [];
      },
      async remember(contacts, input: NewContact) {
        const next = addToBook(contacts, input);
        await saveContacts(files, next);
        return next;
      },
      async forget(contacts, code) {
        const next = removeFromBook(contacts, code);
        await saveContacts(files, next);
        return next;
      },
      async noteSeen(contacts, invite, now = new Date()) {
        const next = learnContact(contacts, invite, now);
        await saveContacts(files, next);
        return next;
      },
    },
  };
}

async function saveContacts(files: FilesService, contacts: readonly SyncContact[]): Promise<void> {
  await writeText(files, CONTACTS_PATH, `${JSON.stringify({ version: 1, contacts }, null, 2)}\n`);
}
