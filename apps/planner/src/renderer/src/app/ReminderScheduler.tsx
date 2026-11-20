import { pendingReminders } from "@suite/planner-core";
import { useEffect, useRef } from "react";
import { getBridge } from "../platform/bridge";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";

const BLOCKED = "Reminders are off: notifications are blocked for Suite Go in system settings.";
const UNAVAILABLE = "Reminders are not available on this device.";

/**
 * Hands the pending reminders to a host that can deliver them, and says when it cannot.
 *
 * The desktop app's main process runs its own scheduler, so its bridge has no `syncReminders` and
 * this component does nothing there. A container-hosted pack has one, and a phone is the place
 * where "later" has to survive the app being closed.
 *
 * The permission is asked once and recorded in the document. A platform forgets a denial when the
 * person revokes the permission, which resets it to "ask again"; without the record this would
 * open the system prompt again on the next edit, so the record turns a repeat into a sentence.
 */
export function ReminderScheduler(): null {
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const setNotice = useUiStore((state) => state.setNotice);
  const bridge = getBridge();

  const reminders = pendingReminders(snapshot.tasks);

  // The key is the set that matters: an edit to another field must not reschedule alarms.
  const key = reminders.map((reminder) => `${reminder.id}@${reminder.at}`).join("|");
  const latest = useRef(reminders);
  latest.current = reminders;
  const settings = useRef(snapshot.settings);
  settings.current = snapshot.settings;

  const syncReminders = bridge.syncReminders;
  const requestNotifications = bridge.requestNotifications;

  // `key` is what this depends on, and the reminders themselves are read through `latest`: the
  // array is new on every render, and depending on it would reschedule on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the change detector
  useEffect(() => {
    if (syncReminders === undefined) return;
    let alive = true;

    const report = (permission: string): void => {
      // Nothing to deliver is not a reason to nag.
      if (!alive || latest.current.length === 0) return;
      setNotice(permission === "unsupported" ? UNAVAILABLE : BLOCKED);
    };

    void (async () => {
      const result = await syncReminders(latest.current);
      if (!alive || result.permission === "granted") return;
      if (latest.current.length === 0) return;

      if (result.permission !== "prompt") {
        report(result.permission);
        return;
      }

      // The platform has not decided. Ask only if this workspace has never asked: a revoked
      // permission comes back as "prompt", and re-opening the prompt on every edit is noise.
      if (settings.current.notificationsAskedAt !== null) {
        report("denied");
        return;
      }
      if (requestNotifications === undefined) return;

      const permission = await requestNotifications();
      if (!alive) return;
      replica.document.updateSettings({ notificationsAskedAt: new Date().toISOString() });

      if (permission === "granted" && latest.current.length > 0) {
        await syncReminders(latest.current);
        return;
      }
      report(permission);
    })().catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [key]);

  return null;
}
