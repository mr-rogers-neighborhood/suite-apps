import { describe, expect, it } from "vitest";

import { nextOccurrence, occurrencesBetween } from "./recurrence";

describe("nextOccurrence", () => {
  it("should keep a month-end anchor through a short February", () => {
    expect(nextOccurrence("2026-01-31", "monthly", 1, "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", "monthly", 1, "2026-01-31")).toBe("2026-03-31");
    expect(nextOccurrence("2024-01-31", "monthly", 1, "2024-01-31")).toBe("2024-02-29");
    expect(nextOccurrence("2024-02-29", "monthly", 1, "2024-01-31")).toBe("2024-03-31");
  });

  it("should keep a yearly leap-day anchor", () => {
    expect(nextOccurrence("2024-02-29", "yearly", 1, "2024-02-29")).toBe("2025-02-28");
    expect(nextOccurrence("2025-02-28", "yearly", 1, "2024-02-29")).toBe("2026-02-28");
    expect(nextOccurrence("2027-02-28", "yearly", 1, "2024-02-29")).toBe("2028-02-29");
  });

  it("should step by the interval", () => {
    expect(nextOccurrence("2026-01-15", "monthly", 2, "2026-01-15")).toBe("2026-03-15");
    expect(nextOccurrence("2026-01-15", "weekly", 2, "2026-01-15")).toBe("2026-01-29");
    expect(nextOccurrence("2026-01-30", "daily", 3, "2026-01-30")).toBe("2026-02-02");
    expect(nextOccurrence("2026-01-31", "monthly", 12, "2026-01-31")).toBe("2027-01-31");
  });

  it("should advance even when the interval is zero or negative", () => {
    expect(nextOccurrence("2026-01-15", "monthly", 0, "2026-01-15")).toBe("2026-02-15");
    expect(nextOccurrence("2026-01-15", "weekly", -3, "2026-01-15")).toBe("2026-01-22");
  });
});

describe("occurrencesBetween", () => {
  it("should stop before the end date and keep the anchor", () => {
    expect(occurrencesBetween("2026-01-31", "2026-04-30", "monthly", 1, "2026-01-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("should include the end date and cap the list", () => {
    expect(occurrencesBetween("2026-01-01", "2026-01-03", "daily", 1, "2026-01-01")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(
      occurrencesBetween("2026-01-01", "2026-12-31", "daily", 1, "2026-01-01", 5),
    ).toHaveLength(5);
  });
});
