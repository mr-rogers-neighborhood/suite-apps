import { type DateKey, type FocusSession, toDateKey } from "@suite/planner-core";

function sessionStartedOn(session: FocusSession, dateKey: DateKey): boolean {
  return toDateKey(new Date(session.startedAt)) === dateKey;
}

export function sessionsOn(sessions: readonly FocusSession[], dateKey: DateKey): FocusSession[] {
  return sessions.filter((session) => sessionStartedOn(session, dateKey));
}

/**
 * The seconds a session has actually run.
 *
 * An ended session stops at its stored `endedAt`; a running one uses the clock at render. Neither
 * value is persisted back, so a reload resumes the same countdown from the same two timestamps.
 */
export function elapsedSeconds(session: FocusSession, now: Date): number {
  const end = session.endedAt === null ? now.getTime() : new Date(session.endedAt).getTime();
  return Math.max(0, Math.round((end - new Date(session.startedAt).getTime()) / 1000));
}

export function elapsedMinutes(session: FocusSession, now: Date): number {
  return Math.round(elapsedSeconds(session, now) / 60);
}

/** Seconds left against the planned length; negative once the session has run over. */
export function remainingSeconds(session: FocusSession, now: Date): number {
  return session.plannedMinutes * 60 - elapsedSeconds(session, now);
}

export function formatCountdown(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const total = Math.abs(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${sign}${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
