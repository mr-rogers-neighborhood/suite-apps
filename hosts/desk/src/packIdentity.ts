import { join } from "node:path";
import { isSafePackId } from "@suite/pack/manifest";
import { isSafePublisherId, SUITE_PUBLISHER_ID } from "@suite/pack/trust";

/**
 * Where a publisher's pack keeps its storage (S2.2).
 *
 * A pack's install identity is `(publisher id, pack id)`. Documents, files and
 * the renderer session are keyed by both, so a different publisher installing
 * under the same pack id starts empty instead of reading the previous owner's
 * data.
 *
 * The first-party publisher keeps the pre-S2.1 path. That is a deliberate
 * compatibility exception: scoping `suite` too would move every document and
 * file a person already has, and silently orphaning them is worse than one
 * documented legacy segment that only the pinned key can reach. Every other
 * publisher gets a segment that contains its id.
 */

export const FIRST_PARTY_PUBLISHER_ID = SUITE_PUBLISHER_ID;

/**
 * The one storage segment a pack's data lives under.
 *
 * `suite` keeps the bare pack id (the old layout); another publisher is
 * `<publisher>~<pack-id>`. Both ids are lower-case kebab-case, so `~` cannot
 * occur in either and two pairs cannot collide.
 */
export function packStorageKey(publisherId: string, packId: string): string {
  if (!isSafePublisherId(publisherId)) throw new Error("invalid publisher id");
  if (!isSafePackId(packId)) throw new Error("invalid pack id");
  return publisherId === FIRST_PARTY_PUBLISHER_ID ? packId : `${publisherId}~${packId}`;
}

/**
 * The document root for one publisher.
 *
 * The document store resolves `<container>/<pack>` under its root, so a
 * non-first-party publisher gets its own root under `documents/`, while the
 * first-party publisher keeps `documents/` itself.
 */
export function documentsRootFor(dataRoot: string, publisherId: string): string {
  if (!isSafePublisherId(publisherId)) throw new Error("invalid publisher id");
  return publisherId === FIRST_PARTY_PUBLISHER_ID
    ? join(dataRoot, "documents")
    : join(dataRoot, "documents", publisherId);
}

/** The path a person sees for a pack's documents, relative to the data root. */
export function documentScopeLabel(publisherId: string): string | null {
  if (!isSafePublisherId(publisherId)) throw new Error("invalid publisher id");
  return publisherId === FIRST_PARTY_PUBLISHER_ID ? null : publisherId;
}
