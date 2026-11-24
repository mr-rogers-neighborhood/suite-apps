import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseProjectedReminders,
  type ReminderClock,
  type ReminderDelivery,
  type ReminderPermission,
  ReminderProjectionError,
  ReminderQueue,
  type ReminderRow,
  ReminderScheduler,
  type ReminderShowResult,
  type ReminderTimer,
} from "./reminders.js";

const PACK = "planner";
const NOW = Date.parse("2026-11-24T09:00:00.000Z");

/** A clock the test advances, so no test waits for wall time. */
class ManualClock implements ReminderClock {
  #now: number;
  #next = 0;
  readonly #timers = new Map<number, { readonly at: number; readonly fire: () => void }>();

  constructor(now: number) {
    this.#now = now;
  }

  now(): number {
    return this.#now;
  }

  setTimer(at: number, fire: () => void): ReminderTimer {
    this.#next += 1;
    const id = this.#next;
    this.#timers.set(id, { at: Math.max(at, this.#now), fire });
    return { cancel: () => this.#timers.delete(id) };
  }

  advance(ms: number): void {
    this.#now += ms;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= this.#now)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (due === undefined) return;
      this.#timers.delete(due[0]);
      due[1].fire();
    }
  }
}

interface FakeDelivery extends ReminderDelivery {
  readonly shown: ReminderRow[];
  requests: number;
  result: ReminderShowResult;
}

function delivery(
  permission: ReminderPermission = "granted",
  result: ReminderShowResult = "shown",
) {
  const shown: ReminderRow[] = [];
  const fake: FakeDelivery = {
    shown,
    requests: 0,
    result,
    async request() {
      fake.requests += 1;
      return permission;
    },
    show(row) {
      shown.push(row);
      return fake.result;
    },
  };
  return fake;
}

const roots: string[] = [];

async function queueFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-shell-reminders-"));
  roots.push(root);
  return join(root, "reminders.json");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function projected(id = "a", at = NOW + 60_000) {
  return {
    id,
    title: "Draft the plan",
    body: "Ship the pack",
    at,
    deepLink: `suite://${PACK}/task/${id}`,
  };
}

describe("the reminder queue", () => {
  it("stores a pack's rows with the capture time and survives a reopen", async () => {
    const file = await queueFile();
    const queue = await ReminderQueue.open(file);
    await queue.replacePack(PACK, [projected()], NOW);

    const reopened = await ReminderQueue.open(file);
    expect(reopened.rows()).toEqual([
      {
        ...projected(),
        packId: PACK,
        capturedAt: NOW,
      },
    ]);
  });

  it("replaces one pack's rows, leaves another pack alone, and is idempotent", async () => {
    const queue = await ReminderQueue.open(await queueFile());
    await queue.replacePack(PACK, [projected()], NOW);
    await queue.replacePack("budget", [projected("b", NOW + 120_000)], NOW);

    await queue.replacePack(PACK, [projected("c", NOW + 30_000)], NOW);
    const after = queue.rows();
    await queue.replacePack(PACK, [projected("c", NOW + 30_000)], NOW);

    expect(queue.rows()).toEqual(after);
    expect(after.filter((row) => row.packId === PACK).map((row) => row.id)).toEqual(["c"]);
    expect(after.filter((row) => row.packId === "budget").map((row) => row.id)).toEqual(["b"]);
  });

  it("removes every row a pack owns", async () => {
    const queue = await ReminderQueue.open(await queueFile());
    await queue.replacePack(PACK, [projected("a"), projected("b", NOW + 120_000)], NOW);
    await queue.replacePack("budget", [projected("c")], NOW);

    await queue.remove(PACK, "a");
    expect(queue.rowsFor(PACK).map((row) => row.id)).toEqual(["b"]);

    await queue.removePack(PACK);
    expect(queue.rowsFor(PACK)).toEqual([]);
    expect(queue.rowsFor("budget")).toHaveLength(1);
  });

  it("prunes a pack that is no longer installed or no longer declares notifications", async () => {
    const queue = await ReminderQueue.open(await queueFile());
    await queue.replacePack(PACK, [projected()], NOW);
    await queue.replacePack("budget", [projected("b")], NOW);

    await queue.prune(new Set(["budget"]));

    expect(queue.rowsFor(PACK)).toEqual([]);
    expect(queue.rowsFor("budget")).toHaveLength(1);
  });

  it("validates the rows a pack projects", () => {
    expect(parseProjectedReminders([projected()], PACK)).toEqual([projected()]);

    expect(() =>
      parseProjectedReminders([{ ...projected(), deepLink: "suite://canvas/task/a" }], PACK),
    ).toThrow(ReminderProjectionError);
    expect(() => parseProjectedReminders([{ ...projected(), at: Number.NaN }], PACK)).toThrow(
      ReminderProjectionError,
    );
    expect(() => parseProjectedReminders([{ ...projected(), title: "" }], PACK)).toThrow(
      ReminderProjectionError,
    );
    expect(() => parseProjectedReminders([projected(), projected()], PACK)).toThrow(
      ReminderProjectionError,
    );
  });
});

describe("the reminder scheduler", () => {
  let file: string;
  let queue: ReminderQueue;

  beforeEach(async () => {
    file = await queueFile();
    queue = await ReminderQueue.open(file);
  });

  it("fires a due row with the pack closed, then removes it", async () => {
    const clock = new ManualClock(NOW);
    const fake = delivery();
    const scheduler = new ReminderScheduler({ queue, clock, delivery: fake });
    await queue.replacePack(PACK, [projected("a", NOW + 60_000)], NOW);
    await scheduler.start();

    clock.advance(59_999);
    await scheduler.settle();
    expect(fake.shown).toEqual([]);
    expect(queue.rows()).toHaveLength(1);

    clock.advance(1);
    await scheduler.settle();
    expect(fake.shown.map((row) => row.id)).toEqual(["a"]);
    expect(queue.rows()).toEqual([]);
    scheduler.stop();
  });

  it("delivers an overdue row as soon as the scheduler starts", async () => {
    const clock = new ManualClock(NOW);
    const fake = delivery();
    const scheduler = new ReminderScheduler({ queue, clock, delivery: fake });
    await queue.replacePack(PACK, [projected("a", NOW - 60_000)], NOW);

    await scheduler.start();
    clock.advance(0);
    await scheduler.settle();

    expect(fake.shown.map((row) => row.id)).toEqual(["a"]);
    scheduler.stop();
  });

  it("arms for the next row after the first one fires", async () => {
    const clock = new ManualClock(NOW);
    const fake = delivery();
    const scheduler = new ReminderScheduler({ queue, clock, delivery: fake });
    await queue.replacePack(PACK, [projected("a", NOW + 1_000), projected("b", NOW + 2_000)], NOW);
    await scheduler.start();

    clock.advance(1_000);
    await scheduler.settle();
    expect(fake.shown.map((row) => row.id)).toEqual(["a"]);

    clock.advance(1_000);
    await scheduler.settle();
    expect(fake.shown.map((row) => row.id)).toEqual(["a", "b"]);
    scheduler.stop();
  });

  it("asks once, and shows a denial instead of scheduling", async () => {
    const clock = new ManualClock(NOW);
    const fake = delivery("denied");
    const states: ReminderPermission[] = [];
    const scheduler = new ReminderScheduler({
      queue,
      clock,
      delivery: fake,
      onPermission: (permission) => states.push(permission),
    });
    await queue.replacePack(PACK, [projected("a", NOW + 60_000)], NOW);

    await scheduler.start();
    expect(fake.requests).toBe(1);
    expect(queue.permission).toBe("denied");
    expect(states).toEqual(["denied"]);
    expect(fake.shown).toEqual([]);

    await scheduler.refresh();
    expect(fake.requests).toBe(1);
    clock.advance(60_000);
    await scheduler.settle();
    expect(fake.shown).toEqual([]);
    expect(queue.rows()).toHaveLength(1);
    scheduler.stop();
  });

  it("keeps a denied pack's rows for a later grant", async () => {
    const clock = new ManualClock(NOW);
    const fake = delivery("denied");
    const scheduler = new ReminderScheduler({ queue, clock, delivery: fake });
    await queue.replacePack(PACK, [projected("a", NOW + 60_000)], NOW);
    await scheduler.start();

    await queue.setPermission("granted", clock.now());
    await scheduler.refresh();
    clock.advance(60_000);
    await scheduler.settle();

    expect(fake.shown.map((row) => row.id)).toEqual(["a"]);
    scheduler.stop();
  });

  it("does not ask when there is nothing to deliver", async () => {
    const clock = new ManualClock(NOW);
    const fake = delivery();
    const scheduler = new ReminderScheduler({ queue, clock, delivery: fake });

    await scheduler.start();

    expect(fake.requests).toBe(0);
    scheduler.stop();
  });
});
