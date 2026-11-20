import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type GenesisBody,
  type GenesisRecord,
  genesisPayload,
  genesisRecordSchema,
  verifyGenesis,
} from "@suite/sync";

/**
 * A workspace's identity root, and the one record it signs.
 *
 * The root is Ed25519, one per workspace, made when the workspace is first shared. It
 * encrypts nothing: it names the workspace and signs the genesis, which carries the
 * workspace id, the creation time, the creating device, and the relay the workspace was
 * made against. The private half never leaves the creating device — not to another
 * device, not into the group, not to the relay, not into the document — so the only
 * other copy is the one in that device's recovery kit.
 *
 * It lives beside `sync/identity.json` and is written the same way: through a temporary
 * file, mode 0600, because half a key is not a key.
 *
 * A workspace shared before this file existed has no root and no genesis. That is a
 * workspace without an identity root rather than a broken one: every reader of this
 * module treats a missing file as "no root", never as an error.
 */
const ROOT_DIRECTORY = "roots";

/** The key pair as it sits on disk, and as a recovery file carries it. */
export interface StoredRootFile {
  readonly version: 1;
  readonly publicKey: string;
  readonly privateKey: string;
  readonly genesis: GenesisRecord;
}

export interface GenesisOptions {
  readonly dataDir: string;
  readonly workspaceId: string;
  /** The creating device, as the relay pins it. */
  readonly deviceId: string;
  readonly devicePublicKey: string;
  /** The relay address the workspace was created against. */
  readonly relay: string;
  readonly now?: Date;
}

/** The root file for a workspace, or null for one that has no identity root. */
export async function readRootFile(
  dataDir: string,
  workspaceId: string,
): Promise<StoredRootFile | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(pathFor(dataDir, workspaceId), "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.publicKey !== "string" || typeof record.privateKey !== "string") return null;
  const genesis = genesisRecordSchema.safeParse(record.genesis);
  if (!genesis.success || genesis.data.workspaceId !== workspaceId) return null;
  return {
    version: 1,
    publicKey: record.publicKey,
    privateKey: record.privateKey,
    genesis: genesis.data,
  };
}

/** The signed genesis this workspace has, or null when it predates the identity root. */
export async function readGenesis(
  dataDir: string,
  workspaceId: string,
): Promise<GenesisRecord | null> {
  return (await readRootFile(dataDir, workspaceId))?.genesis ?? null;
}

/**
 * Whether a stored genesis still checks out.
 *
 * The signature is made by the root the record carries, and the workspace id it names is
 * the id this device is in. A record that fails either check is not a genesis this device
 * can rely on, and the honest answer is "no identity root" rather than a guess.
 */
export function genesisChecksOut(
  record: GenesisRecord,
  workspaceId: string,
  verifier: (payload: string, signature: string, publicKey: string) => boolean = verifyEd25519,
): boolean {
  return record.workspaceId === workspaceId && verifyGenesis(record, verifier);
}

/** Install a root carried by a recovery file. Refuses a genesis for another workspace. */
export async function writeRootFile(
  dataDir: string,
  workspaceId: string,
  stored: StoredRootFile,
): Promise<void> {
  if (stored.genesis.workspaceId !== workspaceId) {
    throw new Error("That recovery file's workspace root is for another workspace.");
  }
  if (!genesisChecksOut(stored.genesis, workspaceId)) {
    throw new Error("That recovery file's workspace root could not be checked.");
  }
  await write(pathFor(dataDir, workspaceId), stored);
}

/**
 * Make a root and the genesis it signs, for a workspace that is being shared for the
 * first time.
 *
 * `workspaceId` is the id this app already keeps for the document. The root signs that
 * id rather than replacing it: a Canvas document owns its workspace id before sharing,
 * so it is not a hash of a key that does not exist yet. `workspaceIdFromRootKey` is the
 * derivation for a workspace created root-first, and `genesisNamesItsRoot` says which
 * kind a record is. Reading the root file is the caller's job, so a second share of the
 * same workspace does not make a second root.
 */
export async function createGenesis(options: GenesisOptions): Promise<StoredRootFile> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const body: GenesisBody = {
    workspaceId: options.workspaceId,
    rootPublicKey: rawPublic.toString("base64"),
    createdAt: (options.now ?? new Date()).toISOString(),
    deviceId: options.deviceId,
    devicePublicKey: options.devicePublicKey,
    relay: options.relay,
  };
  const stored: StoredRootFile = {
    version: 1,
    publicKey: rawPublic.toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    genesis: {
      ...body,
      signature: sign(null, Buffer.from(genesisPayload(body)), privateKey).toString("base64"),
    },
  };
  await write(pathFor(options.dataDir, options.workspaceId), stored);
  return stored;
}

/** Ed25519 over a string payload, with a raw 32-byte base64 key. */
export function verifyEd25519(payload: string, signature: string, publicKey: string): boolean {
  try {
    // 12 bytes of SPKI header, then the 32 raw bytes the protocol carries.
    const prefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = createPublicKey({
      key: Buffer.concat([prefix, Buffer.from(publicKey, "base64")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(payload), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function pathFor(dataDir: string, workspaceId: string): string {
  return join(dataDir, "sync", ROOT_DIRECTORY, `${workspaceId}.json`);
}

async function write(path: string, stored: StoredRootFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
