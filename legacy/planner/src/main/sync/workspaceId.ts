import { createHash } from "node:crypto";

/**
 * The sync identity of a Planner workspace.
 *
 * The protocol names a workspace with 64 lower-case hex characters. Planner's own id is
 * `workspace_<uuid>`, and a schema change to replace it is not needed: hashing the id it
 * already carries gives both devices the same name for the same file, without inventing a
 * second notion of "which workspace". The prefix keeps this fingerprint from ever being
 * mistaken for a fingerprint of some other app's document.
 */
export function toSyncWorkspaceId(plannerWorkspaceId: string): string {
  return createHash("sha256")
    .update(`suite-planner/workspace\n${plannerWorkspaceId}`)
    .digest("hex");
}
