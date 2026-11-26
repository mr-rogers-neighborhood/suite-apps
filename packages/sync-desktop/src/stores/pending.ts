import {
  type createDeviceIdentity,
  decodeBase64,
  decodeKeyPackageBytes,
  encodeBase64,
  encodeKeyPackageBytes,
} from "@suite/sync";

import { decodeStoreText, encodeStoreText, SYNC_STORE_ROOT, type SyncStoreFiles } from "./port.js";

/**
 * The identity a device made in order to ask to join, kept until somebody answers.
 *
 * An invitation is spent the moment the relay stores the key package, so the identity behind
 * that key package is the only thing that can open the welcome that comes back. Held in a
 * variable it lasted until the app closed, which is a promise that ends when a window does:
 * quit here and the invitation is gone while the other person adds a device that will never
 * appear. So it goes on disk, keyed by workspace, and the join resumes on launch.
 */
export type PendingIdentity = Awaited<ReturnType<typeof createDeviceIdentity>>;

interface StoredPending {
  readonly version: 1;
  readonly name: string;
  readonly keyPackage: string;
  /** The relay this device asked, so the wait can pick up where it left off. */
  readonly host: string;
  readonly private: {
    readonly initPrivateKey: string;
    readonly hpkePrivateKey: string;
    readonly signaturePrivateKey: string;
  };
}

/** A join that has not finished yet: what to open the welcome with, and where to wait. */
export interface PendingJoin {
  readonly identity: PendingIdentity;
  readonly host: string;
}

export interface PendingStore {
  load(): Promise<PendingJoin | null>;
  save(identity: PendingIdentity, host: string): Promise<void>;
  clear(): Promise<void>;
}

export function createPendingStore(files: SyncStoreFiles, workspaceId: string): PendingStore {
  const target = `${SYNC_STORE_ROOT}/pending/${workspaceId}.json`;

  return {
    async load() {
      const bytes = await files.read(target);
      if (bytes === null) return null;
      let parsed: StoredPending;
      try {
        parsed = JSON.parse(decodeStoreText(bytes)) as StoredPending;
      } catch {
        return null;
      }

      const initPrivateKey = decodeBase64(parsed.private?.initPrivateKey ?? "");
      const hpkePrivateKey = decodeBase64(parsed.private?.hpkePrivateKey ?? "");
      const signaturePrivateKey = decodeBase64(parsed.private?.signaturePrivateKey ?? "");
      if (initPrivateKey === null || hpkePrivateKey === null || signaturePrivateKey === null) {
        return null;
      }
      if (typeof parsed.host !== "string" || parsed.host.length === 0) return null;

      try {
        const keyPackage = decodeBase64(parsed.keyPackage);
        if (keyPackage === null) return null;
        return {
          host: parsed.host,
          identity: {
            name: parsed.name,
            keyPackage: decodeKeyPackageBytes(keyPackage),
            privateKeys: { initPrivateKey, hpkePrivateKey, signaturePrivateKey },
          },
        };
      } catch {
        // A file from an older protocol, or a damaged one, is not a reason to refuse to start.
        return null;
      }
    },

    async save(identity, host) {
      const stored: StoredPending = {
        version: 1,
        name: identity.name,
        keyPackage: encodeBase64(encodeKeyPackageBytes(identity.keyPackage)),
        host,
        private: {
          initPrivateKey: encodeBase64(identity.privateKeys.initPrivateKey),
          hpkePrivateKey: encodeBase64(identity.privateKeys.hpkePrivateKey),
          signaturePrivateKey: encodeBase64(identity.privateKeys.signaturePrivateKey),
        },
      };
      // The port writes through a temporary file: half a key package is not a key package, and
      // a crash should leave the previous attempt intact rather than a file nothing can read.
      await files.write(target, encodeStoreText(`${JSON.stringify(stored, null, 2)}\n`));
    },

    async clear() {
      await files.remove(target);
    },
  };
}
