import { pendingReminders } from "@suite/planner-core";
import { useEffect, useRef } from "react";
import { getBridge } from "../platform/bridge";
import { useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";

/**
 * Hands the pending reminders to a host that can deliver them, and says when it cannot.
 *
 * The desktop app's main process runs its own scheduler, so its bridge has no `syncReminders` and
 * this component does nothing there. A container-hosted pack has one, and a phone is the place
 * where "later" has to survive the app being closed. The notice is the point: a reminder that
 * silently never arrives is the one failure a planner cannot afford to hide.
 */
export function ReminderScheduler(): null {
  const snapshot = useWorkspaceSnapshot();
  const setNotice = useUiStore((state) => state.setNotice);
  const bridge = getBridge();

  const reminders = pendingReminders(snapshot.tasks);

  // The key is the set that matters: an edit to another field must not reschedule alarms.
  const key = reminders.map((reminder) => `${reminder.id}@${reminder.at}`).join("|");
  const latest = useRef(reminders);
  latest.current = reminders;
  const syncReminders = bridge.syncReminders;

  // `key` is what this depends on, and the reminders themselves are read through `latest`: the
  // array is new on every render, and depending on it would reschedule on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the change detector
  useEffect(() => {
    if (syncReminders === undefined) return;
    let alive = true;

    void syncReminders(latest.current)
      .then((result) => {
        if (!alive) return;
        // Nothing to deliver is not a reason to nag. The notice is about reminders that exist
        // and cannot arrive.
        if (latest.current.length === 0) return;
        if (result.permission === "denied") {
          setNotice(
            "Reminders are off: notifications are blocked for Suite Go in system settings.",
          );
        } else if (result.permission === "unsupported") {
          setNotice("Reminders are not available on this device.");
        }
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [key]);

  return null;
}
