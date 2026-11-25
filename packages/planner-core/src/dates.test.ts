import { describe, expect, it } from "vitest";

import {
  addDaysToKey,
  differenceInDays,
  humanDayLabel,
  isValidDateKey,
  startOfWeekKey,
  toDateKey,
} from "./dates";

// Local constructors throughout: a DateKey is a local calendar day, and a UTC literal would make
// these assertions depend on the machine's zone.
describe("addDaysToKey", () => {
  it("should cross the end of a month and the end of a year", () => {
    expect(addDaysToKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToKey("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("should include a leap day and leave it again the next day", () => {
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToKey("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDaysToKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("should not invent a leap day in a common year", () => {
    expect(addDaysToKey("2027-02-28", 1)).toBe("2027-03-01");
  });
});

describe("startOfWeekKey", () => {
  it("should reach back across a month boundary", () => {
    // 2027-01-01 is a Friday; the Monday of that week is in December.
    expect(startOfWeekKey("2027-01-01", 1)).toBe("2026-12-28");
    // 2027-01-03 is a Sunday; the Monday week still started in December.
    expect(startOfWeekKey("2027-01-03", 1)).toBe("2026-12-28");
  });

  it("should start a leap week on its February 28th", () => {
    // 2028-02-29 is a Tuesday, so the Monday week starts on the 28th.
    expect(startOfWeekKey("2028-02-29", 1)).toBe("2028-02-28");
    expect(startOfWeekKey("2028-03-05", 1)).toBe("2028-02-28");
  });
});

describe("humanDayLabel", () => {
  it("should call the first day of the next month tomorrow", () => {
    expect(humanDayLabel("2026-02-01", "2026-01-31")).toBe("Tomorrow");
    expect(humanDayLabel("2027-01-01", "2026-12-31")).toBe("Tomorrow");
  });

  it("should call the leap day and the day after it relative names", () => {
    expect(humanDayLabel("2028-02-29", "2028-02-28")).toBe("Tomorrow");
    expect(humanDayLabel("2028-03-01", "2028-02-29")).toBe("Tomorrow");
    expect(humanDayLabel("2028-02-28", "2028-02-29")).toBe("Yesterday");
  });
});

describe("date keys", () => {
  it("should round-trip a leap day and reject a day that does not exist", () => {
    expect(isValidDateKey("2028-02-29")).toBe(true);
    expect(isValidDateKey("2027-02-29")).toBe(false);
    expect(toDateKey(new Date(2028, 1, 29))).toBe("2028-02-29");
  });

  it("should measure a month boundary in whole days", () => {
    expect(differenceInDays("2026-02-01", "2026-01-31")).toBe(1);
    expect(differenceInDays("2028-03-01", "2028-02-28")).toBe(2);
  });
});
