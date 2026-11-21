import type { FocusSession } from "@suite/planner-core";
import { describe, expect, it } from "vitest";

import {
  elapsedMinutes,
  elapsedSeconds,
  formatCountdown,
  remainingSeconds,
  sessionsOn,
} from "./sessionTime";

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "focus-1",
    taskId: "task-1",
    startedAt: new Date(2026, 0, 5, 9, 0, 0).toISOString(),
    plannedMinutes: 25,
    endedAt: null,
    ...overrides,
  };
}

describe("elapsed time", () => {
  it("should stop a finished session at endedAt, not at the clock", () => {
    const endedAt = new Date(2026, 0, 5, 9, 12, 0).toISOString();
    const now = new Date(2026, 0, 5, 11, 0, 0);

    expect(elapsedSeconds(session({ endedAt }), now)).toBe(12 * 60);
    expect(elapsedMinutes(session({ endedAt }), now)).toBe(12);
  });

  it("should use the clock for a running session", () => {
    const now = new Date(2026, 0, 5, 9, 20, 0);

    expect(elapsedSeconds(session(), now)).toBe(20 * 60);
    expect(remainingSeconds(session(), now)).toBe(5 * 60);
  });

  it("should go negative when a session runs over its plan", () => {
    const now = new Date(2026, 0, 5, 9, 30, 0);

    expect(remainingSeconds(session(), now)).toBe(-5 * 60);
    expect(formatCountdown(remainingSeconds(session(), now))).toBe("-05:00");
  });
});

describe("sessionsOn", () => {
  it("should keep the sessions started on that local day", () => {
    const today = session();
    const yesterday = session({
      id: "focus-2",
      startedAt: new Date(2026, 0, 4, 23, 0, 0).toISOString(),
    });

    expect(sessionsOn([today, yesterday], "2026-01-05")).toEqual([today]);
  });
});

describe("formatCountdown", () => {
  it("should zero-pad minutes and seconds", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(930)).toBe("15:30");
    expect(formatCountdown(-90)).toBe("-01:30");
  });
});
