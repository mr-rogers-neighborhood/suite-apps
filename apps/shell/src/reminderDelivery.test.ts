import { describe, expect, it } from "vitest";
import { createReminderDelivery, type HostNotification } from "./reminderDelivery.js";
import type { ReminderRow } from "./reminders.js";

const row: ReminderRow = {
  id: "a",
  packId: "planner",
  title: "Draft the plan",
  body: "Ship the pack",
  at: Date.parse("2026-11-24T10:00:00.000Z"),
  deepLink: "suite://planner/task/a",
  capturedAt: Date.parse("2026-11-24T09:00:00.000Z"),
};

function fakeNotification(): HostNotification & {
  click(): void;
  fail(message: string): void;
  shown: number;
} {
  let onClick: (() => void) | null = null;
  let onFailed: ((message: string) => void) | null = null;
  const notification = {
    shown: 0,
    onClick(listener: () => void) {
      onClick = listener;
    },
    onFailed(listener: (message: string) => void) {
      onFailed = listener;
    },
    show() {
      notification.shown += 1;
    },
    click() {
      onClick?.();
    },
    fail(message: string) {
      onFailed?.(message);
    },
  };
  return notification;
}

describe("the reminder delivery binding", () => {
  it("routes a click to the row's deep link", () => {
    const routed: ReminderRow[] = [];
    const notification = fakeNotification();
    const delivery = createReminderDelivery(
      {
        isSupported: () => true,
        ask: async () => "granted",
        create: () => notification,
      },
      { onRoute: (clicked) => routed.push(clicked) },
    );

    expect(delivery.show(row)).toBe("shown");
    expect(notification.shown).toBe(1);
    notification.click();

    expect(routed).toEqual([row]);
  });

  it("reports an unsupported system and a failed show instead of swallowing them", () => {
    const unsupported = createReminderDelivery(
      {
        isSupported: () => false,
        ask: async () => "granted",
        create: () => fakeNotification(),
      },
      { onRoute: () => undefined },
    );
    expect(unsupported.show(row)).toBe("unsupported");

    const failed = createReminderDelivery(
      {
        isSupported: () => true,
        ask: async () => "granted",
        create: () => {
          throw new Error("no notification service");
        },
      },
      { onRoute: () => undefined },
    );
    expect(failed.show(row)).toBe("failed");
  });
});
