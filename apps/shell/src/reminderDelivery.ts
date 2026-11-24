import type {
  ReminderDelivery,
  ReminderPermission,
  ReminderRow,
  ReminderShowResult,
} from "./reminders.js";

/**
 * The OS half of reminder delivery, kept away from Electron.
 *
 * A platform creates one notification handle per row. The host owns the policy:
 * a click routes the row's deep link, and a failed show is reported rather than
 * swallowed. The real platform is a thin wrapper over Electron's `Notification`
 * in `main.ts`; tests use a fake one, so no window opens in the gate.
 */
export interface HostNotification {
  onClick(listener: () => void): void;
  onFailed(listener: (message: string) => void): void;
  show(): void;
}

export interface ReminderPlatform {
  /** False when the OS has no notification channel at all. */
  isSupported(): boolean;
  /** Ask the person once. A denial is remembered by the queue, not re-asked. */
  ask(): Promise<ReminderPermission>;
  create(row: ReminderRow): HostNotification;
}

export interface ReminderDeliveryHooks {
  /** The row the person clicked, after the notification was shown. */
  readonly onRoute: (row: ReminderRow) => void;
  /** A notification the OS refused, after it was accepted for display. */
  readonly onFailed?: (row: ReminderRow, message: string) => void;
}

export function createReminderDelivery(
  platform: ReminderPlatform,
  hooks: ReminderDeliveryHooks,
): ReminderDelivery {
  return {
    async request(): Promise<ReminderPermission> {
      if (!platform.isSupported()) return "unsupported";
      try {
        return await platform.ask();
      } catch {
        return "denied";
      }
    },

    show(row: ReminderRow): ReminderShowResult {
      if (!platform.isSupported()) return "unsupported";
      try {
        const notification = platform.create(row);
        notification.onClick(() => hooks.onRoute(row));
        notification.onFailed((message) => hooks.onFailed?.(row, message));
        notification.show();
        return "shown";
      } catch {
        return "failed";
      }
    },
  };
}
