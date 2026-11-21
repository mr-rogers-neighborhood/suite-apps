import { describe, expect, it } from "vitest";

import { BudgetDocument, monthState, moveMoney } from "../index";

const NOW = new Date("2026-01-01T12:00:00.000Z");

function setup() {
  const doc = BudgetDocument.create({ name: "Test", currency: "USD", now: NOW });
  const group = doc.createCategoryGroup({ name: "Everyday" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
  const rent = doc.createCategory({ groupId: group.id, name: "Rent" }, NOW);
  const account = doc.createAccount(
    {
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 100_000,
      startingDate: "2026-01-01",
    },
    NOW,
  );
  doc.setAssigned("2026-01", food.id, 30_000, NOW);
  doc.setAssigned("2026-01", rent.id, 20_000, NOW);
  return { doc, group, food, rent, account };
}

function available(doc: BudgetDocument, categoryId: string): number {
  const state = monthState(doc.getSnapshot(), "2026-01");
  const row = state.groups
    .flatMap((group) => group.categories)
    .find((entry) => entry.category.id === categoryId);
  if (!row) throw new Error("Expected a category row");
  return row.availableMinor;
}

describe("moveMoney", () => {
  it("should move from Ready to Assign without changing the total", () => {
    const { doc, food } = setup();
    const before = monthState(doc.getSnapshot(), "2026-01");

    const result = moveMoney(before, {
      fromCategoryId: "rta",
      toCategoryId: food.id,
      amountMinor: 10_000,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    doc.applyAssignments("2026-01", result.value, NOW);

    const after = monthState(doc.getSnapshot(), "2026-01");
    expect(available(doc, food.id)).toBe(40_000);
    expect(after.readyToAssignMinor).toBe(before.readyToAssignMinor - 10_000);
    expect(after.availableMinor).toBe(before.availableMinor + 10_000);
    expect(after.availableMinor + after.readyToAssignMinor).toBe(after.onBudgetBalanceMinor);
  });

  it("should move between envelopes without changing Ready to Assign", () => {
    const { doc, food, rent } = setup();
    const before = monthState(doc.getSnapshot(), "2026-01");

    const result = moveMoney(before, {
      fromCategoryId: food.id,
      toCategoryId: rent.id,
      amountMinor: 5_000,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect([...result.value.values()].reduce((sum, delta) => sum + delta, 0)).toBe(0);
    doc.applyAssignments("2026-01", result.value, NOW);

    expect(available(doc, food.id)).toBe(25_000);
    expect(available(doc, rent.id)).toBe(25_000);
    expect(monthState(doc.getSnapshot(), "2026-01").readyToAssignMinor).toBe(
      before.readyToAssignMinor,
    );
  });

  it("should refuse zero, negative, fractional and overdrawing moves", () => {
    const { doc, food, rent } = setup();
    const state = monthState(doc.getSnapshot(), "2026-01");

    for (const amountMinor of [0, -100, 10.5]) {
      expect(
        moveMoney(state, {
          fromCategoryId: food.id,
          toCategoryId: rent.id,
          amountMinor,
        }).isErr(),
      ).toBe(true);
    }
    expect(
      moveMoney(state, {
        fromCategoryId: food.id,
        toCategoryId: food.id,
        amountMinor: 100,
      }).isErr(),
    ).toBe(true);
    expect(
      moveMoney(state, {
        fromCategoryId: food.id,
        toCategoryId: rent.id,
        amountMinor: 30_001,
      }).isErr(),
    ).toBe(true);
    expect(
      moveMoney(state, {
        fromCategoryId: "rta",
        toCategoryId: rent.id,
        amountMinor: state.readyToAssignMinor + 1,
      }).isErr(),
    ).toBe(true);
  });
});
