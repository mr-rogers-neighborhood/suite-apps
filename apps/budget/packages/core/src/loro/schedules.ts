import type { LoroDoc } from "loro-crdt";

import { addDays, type DateKey, todayKey } from "../dates";
import { createId } from "../ids";
import { nextOccurrence } from "../recurrence";
import {
  type Schedule,
  type ScheduleBatch,
  type ScheduleFrequency,
  scheduleBatchSchema,
  scheduleSchema,
  type TransactionFlag,
} from "../schema";
import { ROOTS } from "./constants";
import { deleteRecord, getRecord, insertRecord, listRecords, updateRecord } from "./records";
import { createTransaction, deleteTransaction, getTransaction } from "./transactions";

/**
 * Occasions older than this are skipped instead of posted. Without a horizon a daily
 * schedule left alone for years would post thousands of rows on one open.
 */
export const AUTO_ENTER_HORIZON_DAYS = 90;

export type NewScheduleInput = {
  accountId: string;
  payeeId?: string | null;
  payeeName?: string;
  categoryId?: string | null;
  amountMinor: number;
  memo?: string;
  flag?: TransactionFlag | null;
  frequency: ScheduleFrequency;
  interval?: number;
  anchorDate?: DateKey;
  endDate?: DateKey | null;
  autoEnter?: boolean;
};

export type ScheduleAutoEnterResult = {
  batch: ScheduleBatch | null;
  postedCount: number;
  totalAmountMinor: number;
  /** Occurrences skipped because they fell before the horizon. */
  skippedBefore: number;
  /** Schedules that were due but carry a zero amount; no transaction can be zero. */
  skippedZero: number;
};

export class ScheduleError extends Error {
  constructor(
    readonly code: "not-found" | "ended" | "reconciled",
    message: string,
  ) {
    super(message);
    this.name = "ScheduleError";
  }
}

export function listSchedules(doc: LoroDoc): Schedule[] {
  return listRecords(doc, ROOTS.schedules, scheduleSchema).sort((left, right) =>
    left.nextDate.localeCompare(right.nextDate),
  );
}

function getSchedule(doc: LoroDoc, id: string): Schedule | undefined {
  return getRecord(doc, ROOTS.schedules, id, scheduleSchema);
}

function requireSchedule(doc: LoroDoc, id: string): Schedule {
  const schedule = getSchedule(doc, id);
  if (!schedule) throw new ScheduleError("not-found", `Schedule ${id} does not exist`);
  return schedule;
}

export function createSchedule(
  doc: LoroDoc,
  input: NewScheduleInput,
  now: Date = new Date(),
): Schedule {
  const anchorDate = input.anchorDate ?? todayKey(now);
  const interval = input.interval ?? 1;
  let nextDate = anchorDate;
  while (nextDate < todayKey(now)) {
    nextDate = nextOccurrence(nextDate, input.frequency, interval, anchorDate);
  }
  const timestamp = now.toISOString();
  const schedule = scheduleSchema.parse({
    id: createId("sched"),
    accountId: input.accountId,
    payeeId: input.payeeId ?? null,
    payeeName: input.payeeName ?? "",
    categoryId: input.categoryId ?? null,
    amountMinor: input.amountMinor,
    memo: input.memo ?? "",
    flag: input.flag ?? null,
    frequency: input.frequency,
    interval,
    anchorDate,
    nextDate,
    endDate: input.endDate ?? null,
    autoEnter: input.autoEnter ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  insertRecord(doc, ROOTS.schedules, scheduleSchema, schedule);
  return schedule;
}

export function updateSchedule(
  doc: LoroDoc,
  id: string,
  patch: Partial<Omit<Schedule, "id" | "createdAt" | "updatedAt">>,
  now: Date = new Date(),
): Schedule {
  return updateRecord(doc, ROOTS.schedules, id, scheduleSchema, patch, {
    key: "updatedAt",
    value: now.toISOString(),
  });
}

export function deleteSchedule(doc: LoroDoc, id: string): void {
  deleteRecord(doc, ROOTS.schedules, id);
}

export function enterSchedule(
  doc: LoroDoc,
  id: string,
  now: Date = new Date(),
): { schedule: Schedule; transactionId: string } {
  const schedule = requireSchedule(doc, id);
  const transaction = createTransaction(
    doc,
    {
      accountId: schedule.accountId,
      date: schedule.nextDate,
      amountMinor: schedule.amountMinor,
      payeeId: schedule.payeeId,
      payeeName: schedule.payeeName,
      categoryId: schedule.categoryId,
      memo: schedule.memo,
      cleared: "uncleared",
      flag: schedule.flag,
      scheduledId: schedule.id,
    },
    now,
  );
  const nextDate = nextOccurrence(
    schedule.nextDate,
    schedule.frequency,
    schedule.interval,
    schedule.anchorDate,
  );
  const updated = updateRecord(doc, ROOTS.schedules, id, scheduleSchema, {
    nextDate,
    updatedAt: now.toISOString(),
  });
  return { schedule: updated, transactionId: transaction.id };
}

/** Newest first. `undoneAt` records are kept as history but ignored by the notice. */
export function listScheduleBatches(doc: LoroDoc): ScheduleBatch[] {
  return listRecords(doc, ROOTS.scheduleBatches, scheduleBatchSchema).sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

export function latestScheduleBatch(doc: LoroDoc): ScheduleBatch | undefined {
  return listScheduleBatches(doc).find((batch) => batch.undoneAt === null);
}

/**
 * Posts every missed auto-entering occurrence from each schedule's `nextDate` through
 * today, using the same `enterSchedule` path as the manual Enter action. Each occurrence
 * is a separate transaction and advances `nextDate`, so reopening cannot post a date
 * twice. The run is recorded as one batch, which is what the notice undoes.
 */
export function autoEnterSchedules(
  doc: LoroDoc,
  now: Date = new Date(),
  options: { horizonDays?: number } = {},
): ScheduleAutoEnterResult {
  const today = todayKey(now);
  const horizonDays = Math.max(1, options.horizonDays ?? AUTO_ENTER_HORIZON_DAYS);
  const horizonStart = addDays(today, -horizonDays);
  const transactionIds: string[] = [];
  const runs: ScheduleBatch["runs"] = [];
  let totalAmountMinor = 0;
  let skippedBefore = 0;
  let skippedZero = 0;

  for (const schedule of listSchedules(doc)) {
    if (!schedule.autoEnter || schedule.nextDate > today) continue;
    if (schedule.endDate && schedule.nextDate > schedule.endDate) continue;
    if (schedule.amountMinor === 0) {
      // A zero transaction is invalid, so a zero schedule stays advisory until edited.
      skippedZero += 1;
      continue;
    }

    const nextDateBefore = schedule.nextDate;
    let cursor = schedule.nextDate;
    let skipped = 0;
    let guard = 0;
    while (cursor < horizonStart && guard < 100_000) {
      const next = nextOccurrence(
        cursor,
        schedule.frequency,
        schedule.interval,
        schedule.anchorDate,
      );
      if (next === cursor) break;
      cursor = next;
      skipped += 1;
      guard += 1;
      if (schedule.endDate && cursor > schedule.endDate) break;
    }
    skippedBefore += skipped;

    if (cursor !== schedule.nextDate) {
      // Move past occurrences the horizon declines to post, or past the end date.
      updateRecord(doc, ROOTS.schedules, schedule.id, scheduleSchema, {
        nextDate: cursor,
        updatedAt: now.toISOString(),
      });
    }
    if (cursor > today || (schedule.endDate && cursor > schedule.endDate)) continue;

    let posted = 0;
    let posts = 0;
    while (posts < 1000) {
      const current = getRecord(doc, ROOTS.schedules, schedule.id, scheduleSchema);
      if (!current || current.nextDate > today) break;
      if (current.endDate && current.nextDate > current.endDate) break;
      const { transactionId } = enterSchedule(doc, schedule.id, now);
      transactionIds.push(transactionId);
      posted += 1;
      posts += 1;
      totalAmountMinor += schedule.amountMinor;
    }
    if (posted > 0) {
      runs.push({ scheduleId: schedule.id, nextDateBefore, postedCount: posted });
    }
  }

  if (transactionIds.length === 0) {
    return {
      batch: null,
      postedCount: 0,
      totalAmountMinor: 0,
      skippedBefore,
      skippedZero,
    };
  }

  const batch = scheduleBatchSchema.parse({
    id: createId("batch"),
    createdAt: now.toISOString(),
    transactionIds,
    totalAmountMinor,
    runs,
    undoneAt: null,
  });
  insertRecord(doc, ROOTS.scheduleBatches, scheduleBatchSchema, batch);
  return {
    batch,
    postedCount: transactionIds.length,
    totalAmountMinor,
    skippedBefore,
    skippedZero,
  };
}

/**
 * Removes exactly the transactions the batch posted and restores each schedule's
 * `nextDate`, then marks the batch undone. The record lives in the document, so this
 * still works after a restart. Refuses a reconciled row rather than breaking a
 * reconciliation.
 */
export function undoScheduleBatch(
  doc: LoroDoc,
  batchId: string,
  now: Date = new Date(),
): ScheduleBatch {
  const batch = getRecord(doc, ROOTS.scheduleBatches, batchId, scheduleBatchSchema);
  if (!batch) throw new ScheduleError("not-found", `Schedule batch ${batchId} does not exist`);
  if (batch.undoneAt) return batch;

  for (const transactionId of batch.transactionIds) {
    const transaction = getTransaction(doc, transactionId);
    if (transaction?.cleared === "reconciled") {
      throw new ScheduleError(
        "reconciled",
        "Unlock the reconciliation before undoing these scheduled entries",
      );
    }
  }
  for (const transactionId of batch.transactionIds) {
    if (getTransaction(doc, transactionId)) deleteTransaction(doc, transactionId);
  }
  for (const run of batch.runs) {
    if (!getRecord(doc, ROOTS.schedules, run.scheduleId, scheduleSchema)) continue;
    updateRecord(doc, ROOTS.schedules, run.scheduleId, scheduleSchema, {
      nextDate: run.nextDateBefore,
      updatedAt: now.toISOString(),
    });
  }
  return updateRecord(doc, ROOTS.scheduleBatches, batchId, scheduleBatchSchema, {
    undoneAt: now.toISOString(),
  });
}
