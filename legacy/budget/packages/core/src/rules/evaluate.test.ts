import { describe, expect, it } from "vitest";

import { applyRules, BudgetDocument, type RuleDraft, ruleSchema } from "../index";

function rule(input: {
  stage?: "pre" | "default" | "post";
  field:
    | "payee"
    | "importedPayee"
    | "memo"
    | "amount"
    | "cleared"
    | "category"
    | "account"
    | "date";
  op: "is" | "isNot" | "contains" | "doesNotContain" | "matches" | "oneOf" | "notOneOf";
  value: string;
  set?: "setCategory" | "setMemo" | "setFlag" | "setCleared";
  action?: string;
}) {
  return ruleSchema.parse({
    id: `rule_${Math.random().toString(36).slice(2)}`,
    stage: input.stage ?? "default",
    conditions: [{ field: input.field, op: input.op, value: input.value }],
    actions: [{ field: input.set ?? "setCategory", value: input.action ?? "cat_target" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

const draft: RuleDraft = {
  accountId: "acct_1",
  accountName: "Checking",
  payeeName: "Amazon Marketplace",
  importedPayee: "AMZN Mktp US*2H4L",
  categoryId: null,
  categoryName: "",
  date: "2026-01-05",
  memo: "Order 123",
  amountMinor: 1_234,
  cleared: "uncleared",
  flag: null,
};

const context = {
  currency: "USD",
  currencyScale: 2,
  categoryNames: new Map([
    ["cat_broad", "Shopping"],
    ["cat_specific", "Amazon"],
    ["cat_target", "Target"],
  ]),
};

describe("applyRules", () => {
  it("should let a specific rule beat a broad one", () => {
    const rules = [
      rule({ field: "payee", op: "contains", value: "amazon", action: "cat_broad" }),
      rule({ field: "payee", op: "is", value: "amazon marketplace", action: "cat_specific" }),
    ];
    const result = applyRules(draft, rules, context);
    expect(result.draft.categoryId).toBe("cat_specific");
    expect(result.draft.categoryName).toBe("Amazon");
    expect(result.matchedRuleIds).toHaveLength(2);
  });

  it("should let a post-stage rule run last", () => {
    const rules = [
      rule({ field: "payee", op: "is", value: "amazon marketplace", action: "cat_specific" }),
      rule({
        stage: "post",
        field: "memo",
        op: "contains",
        value: "order",
        set: "setMemo",
        action: "matched by post",
      }),
    ];
    const result = applyRules(draft, rules, context);
    expect(result.draft.memo).toBe("matched by post");
  });

  it("should match the imported payee and an amount", () => {
    const rules = [
      rule({ field: "importedPayee", op: "contains", value: "amzn", action: "cat_broad" }),
      rule({ field: "amount", op: "is", value: "12.34", action: "cat_specific" }),
    ];
    const result = applyRules(draft, rules, context);
    expect(result.draft.categoryId).toBe("cat_specific");
  });

  it("should skip disabled rules", () => {
    const disabled = { ...rule({ field: "payee", op: "is", value: "anything" }), enabled: false };
    const result = applyRules(draft, [disabled], context);
    expect(result.draft.categoryId).toBeNull();
  });

  it("should match a category by its id or by the name a person typed", () => {
    const byName = rule({
      field: "category",
      op: "is",
      value: "Target",
      set: "setMemo",
      action: "by name",
    });
    const byId = rule({
      field: "category",
      op: "oneOf",
      value: "cat_broad|cat_target",
      set: "setMemo",
      action: "by id",
    });
    const target = { ...draft, categoryId: "cat_target", categoryName: "Target" };

    expect(applyRules(target, [byName], context).draft.memo).toBe("by name");
    expect(applyRules(target, [byId], context).draft.memo).toBe("by id");
    // A negative condition looks at every way the record can be named, so the id differing from
    // the typed name is not enough to call the record a match.
    const notTarget = rule({
      field: "category",
      op: "isNot",
      value: "Target",
      set: "setMemo",
      action: "not target",
    });
    expect(applyRules(target, [notTarget], context).draft.memo).toBe(draft.memo);
  });

  it("should match an account by its id or its name", () => {
    const byName = rule({
      field: "account",
      op: "is",
      value: "Checking",
      set: "setMemo",
      action: "checking",
    });
    const byId = rule({
      field: "account",
      op: "is",
      value: "acct_1",
      set: "setMemo",
      action: "acct",
    });

    expect(applyRules(draft, [byName], context).draft.memo).toBe("checking");
    expect(applyRules(draft, [byId], context).draft.memo).toBe("acct");
    expect(
      applyRules(
        draft,
        [rule({ field: "account", op: "is", value: "Savings", set: "setMemo", action: "no" })],
        context,
      ).draft.memo,
    ).toBe(draft.memo);
  });

  it("should match an amount one-of list in minor units", () => {
    const oneOf = rule({
      field: "amount",
      op: "oneOf",
      value: "10.00|12.34",
      set: "setMemo",
      action: "listed",
    });
    const notOneOf = rule({
      field: "amount",
      op: "notOneOf",
      value: "10.00|99.00",
      set: "setMemo",
      action: "not listed",
    });

    expect(applyRules(draft, [oneOf], context).draft.memo).toBe("listed");
    expect(applyRules(draft, [notOneOf], context).draft.memo).toBe("not listed");
  });
});

describe("learned rules", () => {
  it("should learn a category from a manual edit", () => {
    const doc = BudgetDocument.create({ now: new Date("2026-01-01T12:00:00.000Z") });
    const group = doc.createCategoryGroup({ name: "Group" });
    const food = doc.createCategory({ groupId: group.id, name: "Food" });
    const fun = doc.createCategory({ groupId: group.id, name: "Fun" });
    const account = doc.createAccount({ name: "Checking", type: "checking" });
    const transaction = doc.createTransaction({
      accountId: account.id,
      date: "2026-01-02",
      amountMinor: -2_000,
      categoryId: food.id,
      payeeName: "Shop",
    });

    doc.updateTransaction(transaction.id, { categoryId: fun.id });
    const learned = doc.listRules().filter((candidate) => candidate.source === "learned");
    expect(learned).toHaveLength(1);

    const result = applyRules(
      { ...draft, payeeName: "Shop", importedPayee: "SHOP", amountMinor: -2_000 },
      doc.listRules(),
      {
        currency: "USD",
        currencyScale: 2,
        categoryNames: new Map([[fun.id, "Fun"]]),
      },
    );
    expect(result.draft.categoryId).toBe(fun.id);
  });

  it("should not learn a category when the payee pauses learning", () => {
    const doc = BudgetDocument.create({ now: new Date("2026-01-01T12:00:00.000Z") });
    const group = doc.createCategoryGroup({ name: "Group" });
    const food = doc.createCategory({ groupId: group.id, name: "Food" });
    const fun = doc.createCategory({ groupId: group.id, name: "Fun" });
    const account = doc.createAccount({ name: "Checking", type: "checking" });
    const transaction = doc.createTransaction({
      accountId: account.id,
      date: "2026-01-02",
      amountMinor: -2_000,
      categoryId: food.id,
      payeeName: "Shop",
    });
    const payee = doc.listPayees().find((candidate) => candidate.name === "Shop");
    if (!payee) throw new Error("Expected a payee");
    doc.updatePayee(payee.id, { learn: false });

    doc.updateTransaction(transaction.id, { categoryId: fun.id });
    expect(doc.listRules().filter((candidate) => candidate.source === "learned")).toHaveLength(0);
  });

  it("should learn an imported-payee rename rule", () => {
    const doc = BudgetDocument.create({ now: new Date("2026-01-01T12:00:00.000Z") });
    doc.learnPayeeName("AMZN Mktp US*2H4L", "Amazon", new Date("2026-01-01T12:00:00.000Z"));

    const learned = doc.listRules().find((candidate) => candidate.source === "learned");
    expect(learned?.conditions).toEqual([
      { field: "importedPayee", op: "contains", value: "AMZN Mktp US*2H4L" },
    ]);
    expect(learned?.actions).toEqual([{ field: "setPayee", value: "Amazon" }]);
  });

  it("should update one learned rule when the name differs only by case", () => {
    const doc = BudgetDocument.create({ now: new Date("2026-01-01T12:00:00.000Z") });
    const group = doc.createCategoryGroup({ name: "Group" });
    const food = doc.createCategory({ groupId: group.id, name: "Food" });
    const fun = doc.createCategory({ groupId: group.id, name: "Fun" });
    const account = doc.createAccount({ name: "Checking", type: "checking" });
    const transaction = doc.createTransaction({
      accountId: account.id,
      date: "2026-01-02",
      amountMinor: -2_000,
      categoryId: food.id,
      payeeName: "Shop",
    });
    // An older document could hold a lower-case name; matching is case-insensitive.
    doc.createRule({
      conditions: [{ field: "payee", op: "is", value: "shop" }],
      actions: [{ field: "setCategory", value: food.id }],
      source: "learned",
    });

    doc.updateTransaction(transaction.id, { categoryId: fun.id });

    const learned = doc
      .listRules()
      .filter(
        (candidate) => candidate.source === "learned" && candidate.conditions[0]?.field === "payee",
      );
    expect(learned).toHaveLength(1);
    expect(learned[0]?.conditions[0]?.value).toBe("shop");
    expect(learned[0]?.actions).toEqual([{ field: "setCategory", value: fun.id }]);
  });
});
