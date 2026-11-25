import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createSinceOpened } from "./sinceOpened.js";

const workspaceId = "a".repeat(64);

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "suite-canvas-session-"));
}

describe("what sync did while the workspace was closed", () => {
  it("starts with the previous run's last sync and counts nothing yet", async () => {
    const dataDir = await folder();
    const first = await createSinceOpened({ dataDir, workspaceId });
    expect(first.summary()).toMatchObject({ updates: 0, lastSyncedAt: null });
    first.noteSynced();
    first.noteUpdate();
    await first.flush();

    // A new launch opens the same record: the time survives, the count starts again, because
    // the question is what has arrived *this* time.
    const second = await createSinceOpened({ dataDir, workspaceId });
    expect(second.summary().updates).toBe(0);
    expect(second.summary().lastSyncedAt).not.toBeNull();
  });

  it("writes a small record with no document in it", async () => {
    const dataDir = await folder();
    const at = new Date("2026-11-21T10:00:00.000Z");
    const session = await createSinceOpened({ dataDir, workspaceId, now: () => at });
    session.noteUpdate();
    await session.flush();

    const raw = await readFile(join(dataDir, "sync", "sessions", `${workspaceId}.json`), "utf8");
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      workspaceId,
      openedAt: "2026-11-21T10:00:00.000Z",
      lastSyncedAt: "2026-11-21T10:00:00.000Z",
      updates: 1,
    });
  });

  it("ignores a record for another workspace or a broken one", async () => {
    const dataDir = await folder();
    const foreign = await createSinceOpened({ dataDir, workspaceId: "b".repeat(64) });
    foreign.noteSynced();
    await foreign.flush();

    const session = await createSinceOpened({ dataDir, workspaceId });
    // Different file, so nothing to carry: the count and the time are this workspace's own.
    expect(session.summary().lastSyncedAt).toBeNull();
  });
});
