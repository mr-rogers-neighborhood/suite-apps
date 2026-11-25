import { describe, expect, it } from "vitest";

import { toSyncWorkspaceId } from "./workspaceId";

const plannerId = "workspace_6a4f6e2e-6f5f-4f0e-9f2e-1c2b3a4d5e6f";

describe("the sync name of a Planner workspace", () => {
  it("should be a stable 64-character fingerprint of the id the document carries", () => {
    const first = toSyncWorkspaceId(plannerId);

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(toSyncWorkspaceId(plannerId)).toBe(first);
    // The fingerprint is a name, not a secret, but it must not leak the id it names.
    expect(first).not.toContain(plannerId.slice("workspace_".length, 12));
  });

  it("should give two different workspaces two different names", () => {
    expect(toSyncWorkspaceId(plannerId)).not.toBe(
      toSyncWorkspaceId("workspace_00000000-0000-4000-8000-000000000000"),
    );
  });
});
