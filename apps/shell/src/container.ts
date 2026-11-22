/**
 * The default data identity.
 *
 * A container is the thing that owns documents, pack storage and (later) sync
 * keys. V1 exposes one; the id is already in the document path, the pack origin
 * and the session partition, so adding more is a UI change rather than a storage
 * migration.
 */
export const DEFAULT_CONTAINER_ID = "default";

const CONTAINER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;

export function isSafeContainerId(value: string): boolean {
  return CONTAINER_ID.test(value);
}
