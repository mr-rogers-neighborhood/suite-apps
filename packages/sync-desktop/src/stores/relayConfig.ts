import { normaliseFingerprint } from "@suite/sync";

import { decodeStoreText, encodeStoreText, SYNC_STORE_ROOT, type SyncStoreFiles } from "./port.js";

/**
 * Where this workspace's relay lives and which certificate it must present.
 *
 * The pin is configuration, not document state: it belongs to this installation, is written
 * beside the group, and never travels in a frame or into the renderer's storage. A workspace
 * whose relay is `wss://` cannot connect without it.
 */
export interface RelayConfig {
  readonly host: string;
  /** Null only for a plaintext `ws://` relay on loopback. */
  readonly fingerprint: string | null;
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
 * The app passes its own root, so two apps keep two pins even when both work on the same
 * workspace: the relay address is an installation's choice, not a document field.
 */
export function createRelayConfigStore(
  files: SyncStoreFiles,
  workspaceId: string,
): RelayConfigStore {
  const target = `${SYNC_STORE_ROOT}/relays/${workspaceId}.json`;

  return {
    async load() {
      const bytes = await files.read(target);
      if (bytes === null) return null;
      try {
        const parsed = JSON.parse(decodeStoreText(bytes)) as {
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
      const stored: StoredRelayConfig = {
        version: 1,
        host: config.host,
        fingerprint: config.fingerprint,
      };
      // A pin is not a private key, but it is the trust decision for this workspace; the port
      // keeps it readable only by this account where the platform allows that.
      await files.write(target, encodeStoreText(`${JSON.stringify(stored)}\n`));
    },
  };
}
