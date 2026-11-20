import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { NotificationOutcome, NotificationPermission, NotificationService } from "@suite/go";

/**
 * Local notifications, through the platform's own alarm clock.
 *
 * A reminder that only fires while the app is open is not a reminder, so this is the one host
 * service that hands a scheduled thing to the OS and forgets it. The container stores nothing:
 * a pack asks for the same reminders again on the next launch, which is what makes uninstalling
 * or clearing data leave no orphaned alarms behind that a person cannot see.
 *
 * The plugin is the only part of this that touches a platform API, and the rest is a translation
 * of its states into the contract's four. That separation is what lets the permission rules be
 * tested without a device.
 */

/** Capacitor's notification ids are 32-bit integers. A string id has to become one, stably. */
export function numericNotificationId(id: string): number {
  // FNV-1a: small, stable across processes, and good enough to separate task ids. A collision
  // would replace another reminder rather than add one, which is the safe direction.
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7fffffff;
}

/** The plugin answers "prompt" / "prompt-with-rationale" the first time. */
export function permissionFrom(display: string): NotificationPermission {
  if (display === "granted") return "granted";
  if (display === "denied") return "denied";
  if (display === "prompt" || display === "prompt-with-rationale") return "prompt";
  return "unsupported";
}

/**
 * A notification service for a target with no channel.
 *
 * The web build, a test host, and anything that only needs the contract satisfied use this. It
 * answers `unsupported` rather than pretending a reminder was scheduled.
 */
export function unsupportedNotifications(): NotificationService {
  return {
    permission: async () => "unsupported",
    request: async () => "unsupported",
    schedule: async () => ({ ok: false, permission: "unsupported", reason: "unsupported" }),
    cancel: async () => undefined,
    cancelAll: async () => undefined,
  };
}

export function createNotifications(): NotificationService {
  const supported = Capacitor.isNativePlatform();

  const permission = async (): Promise<NotificationPermission> => {
    if (!supported) return "unsupported";
    try {
      return permissionFrom((await LocalNotifications.checkPermissions()).display);
    } catch {
      return "unsupported";
    }
  };

  const request = async (): Promise<NotificationPermission> => {
    if (!supported) return "unsupported";
    try {
      return permissionFrom((await LocalNotifications.requestPermissions()).display);
    } catch {
      return "unsupported";
    }
  };

  return {
    permission,

    request,

    async schedule(notification): Promise<NotificationOutcome> {
      if (!supported) return { ok: false, permission: "unsupported", reason: "unsupported" };

      // Ask only when the platform has not decided. A denial is final until the person changes
      // it in settings, and a second prompt would not appear anyway.
      const current = await permission();
      const allowed = current === "prompt" ? await request() : current;
      if (allowed !== "granted") {
        return {
          ok: false,
          permission: allowed,
          reason: allowed === "denied" ? "denied" : "unsupported",
        };
      }

      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: numericNotificationId(notification.id),
              title: notification.title,
              // `body` is required by the plugin's schema and never shown, because the title is
              // the whole message. The reminder's id rides along for anything that inspects it.
              body: "",
              extra: { reminderId: notification.id },
              // Inexact on purpose. Asking for an exact alarm makes the plugin launch the
              // "Alarms & reminders" settings screen *while the person is editing a task*, and on
              // an image with no activity for that intent it throws and takes the app down.
              // A reminder that arrives within the platform's idle window is a reminder; a crash
              // while typing is not.
              isExactNotification: false,
              schedule: {
                at: new Date(notification.at),
                allowWhileIdle: true,
              },
            },
          ],
        });
        return { ok: true, permission: "granted" };
      } catch {
        return { ok: false, permission: "granted", reason: "failed" };
      }
    },

    async cancel(id) {
      if (!supported) return;
      try {
        await LocalNotifications.cancel({
          notifications: [{ id: numericNotificationId(id) }],
        });
      } catch {
        // A reminder the platform does not hold is already in the state the caller wants.
      }
    },

    async cancelAll() {
      if (!supported) return;
      try {
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length === 0) return;
        await LocalNotifications.cancel({ notifications: pending.notifications });
      } catch {
        // Same as `cancel`: nothing pending is success.
      }
    },
  };
}
