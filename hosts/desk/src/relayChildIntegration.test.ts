import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { RelaySupervisor } from "./relaySupervisor.js";

/**
 * The seam end to end, without a window.
 *
 * The unit tests fake the worker; this one starts the relay's real worker entry
 * in a thread through the same supervisor the app uses. `@suite/desk`'s
 * `build:all` compiles `dist/relayWorker.js` and the relay it imports before
 * `check:full` runs, so the gate exercises it. A direct `vitest` run against an
 * unbuilt checkout skips rather than fails: the fake tests still cover the
 * contract there, and the supervisor no longer needs the host's executable.
 */
const deskRoot = process.cwd();
const workerEntry = join(deskRoot, "dist", "relayWorker.js");
const relayEntry = join(deskRoot, "..", "..", "services", "relay", "dist", "child.js");

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for the real relay");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe.skipIf(!existsSync(workerEntry) || !existsSync(relayEntry))(
  "the real relay worker",
  () => {
    it("reports ready and stops before it exits", async () => {
      const directory = await mkdtemp(join(tmpdir(), "suite-desk-relay-"));
      const supervisor = new RelaySupervisor({
        worker: pathToFileURL(workerEntry),
        store: join(directory, "relay"),
        host: "127.0.0.1",
        port: 0,
        readinessTimeoutMs: 10_000,
        stopTimeoutMs: 5_000,
      });
      try {
        supervisor.start();
        expect(supervisor.status.state).toBe("starting");
        await waitFor(() => supervisor.ready);

        expect(supervisor.status.address).toMatch(/^wss:\/\/127\.0\.0\.1:\d+\/sync$/u);
        expect(supervisor.status.fingerprint).toMatch(/^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/u);
        expect(supervisor.status.code).toContain("suite://relay?");
        expect(supervisor.status.store).toBe(join(directory, "relay"));
        expect(JSON.stringify(supervisor.status)).not.toContain("documents");

        const stopped = await supervisor.stop();
        expect(stopped.state).toBe("stopped");
        expect(stopped.address).toBeNull();
      } finally {
        await supervisor.stop();
        await rm(directory, { recursive: true, force: true });
      }
    });
  },
);
