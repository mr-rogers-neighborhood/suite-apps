/**
 * What a pack may ask the host for.
 *
 * One vocabulary for desktop and mobile. A host refuses a capability it does not
 * implement, rather than loading a pack into a half-working bridge.
 *
 * `files` is the pack's own scoped storage: relative paths inside the pack's
 * root, plus user-consented external file handles. `storage` is the small
 * key-value service the mobile container already exposes. `relay` is an opaque
 * frame transport, not a general socket.
 */
export const PACK_CAPABILITIES = [
  "documents",
  "storage",
  "files",
  "recents",
  "notifications",
  "network",
  "relay",
  "commands",
] as const;

export type PackCapability = (typeof PACK_CAPABILITIES)[number];

export function isPackCapability(value: unknown): value is PackCapability {
  return typeof value === "string" && (PACK_CAPABILITIES as readonly string[]).includes(value);
}
