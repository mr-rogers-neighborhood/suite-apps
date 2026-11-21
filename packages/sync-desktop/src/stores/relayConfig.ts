import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { normaliseFingerprint } from "@suite/sync";

/**
 * Where this workspace's relay lives and which certificate it must present.
 *
 * The pin is configuration, not document state: it belongs to this installation, is written
 * by the main process beside the group, and never travels in a frame or into the renderer's
 * storage. A workspace whose relay is `wss://` cannot connect without it.
 */
export interface RelayConfig {
  readonly host: string;
  /** Null only for a plaintext `ws://` relay on loopback. */
  readonly fingerprint: string | null;
}

export interface SyncStorePaths {
  readonly dataDir: string;
  readonly workspaceId: string;
}

interface StoredRelayConfig {
  readonly version: 1;
  readonly host: string;
  readonly fingerprint: string | null;
}

export interface RelayConfigStore {
  load(): Promise<RelayConfig | null>;
  save(config: RelayConfig): Promise<void>;
}

/**
 * The relay pin store, rooted at the directory the app owns.
 *
 * The app passes its own data directory, so two apps keep two pins even when both work on
 * the same workspace: the relay address is an installation's choice, not a document field.
 */
export function createRelayConfigStore({ dataDir, workspaceId }: SyncStorePaths): RelayConfigStore {
  const directory = join(dataDir, "sync", "relays");
  const target = join(directory, `${workspaceId}.json`);

  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(target, "utf8")) as {
          host?: unknown;
          fingerprint?: unknown;
        };
        if (typeof parsed.host !== "string" || parsed.host.length === 0) return null;
        const fingerprint =
          typeof parsed.fingerprint === "string" ? normaliseFingerprint(parsed.fingerprint) : null;
        return { host: parsed.host, fingerprint };
      } catch {
        return null;
      }
    },

    async save(config) {
      await mkdir(directory, { recursive: true });
      const temporary = `${target}.tmp`;
      const stored: StoredRelayConfig = {
        version: 1,
        host: config.host,
        fingerprint: config.fingerprint,
      };
      // A pin is not a private key, but it is the trust decision for this workspace; keep it
      // readable only by this account, like the group and the cursor.
      await writeFile(temporary, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
      await rename(temporary, target);
    },
  };
}
