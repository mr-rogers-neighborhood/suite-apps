import { parseMoney } from "../money";
import type { ClearedStatus, Rule, RuleCondition, RuleOperator, TransactionFlag } from "../schema";
import { rankRules } from "./rank";

export type RuleDraft = {
  accountId: string;
  accountName: string;
  payeeName: string;
  importedPayee: string;
  categoryId: string | null;
  categoryName: string;
  date: string;
  memo: string;
  amountMinor: number;
  cleared: ClearedStatus;
  flag: TransactionFlag | null;
};

export type RuleContext = {
  currency: string;
  currencyScale: number;
  categoryNames: ReadonlyMap<string, string>;
};

export type RuleResult = {
  draft: RuleDraft;
  matchedRuleIds: string[];
};

export function applyRules(
  draft: RuleDraft,
  rules: readonly Rule[],
  context: RuleContext,
): RuleResult {
  const next: RuleDraft = { ...draft };
  const matchedRuleIds: string[] = [];

  for (const rule of rankRules(rules)) {
    if (!rule.conditions.every((condition) => matches(next, condition, context))) continue;
    matchedRuleIds.push(rule.id);
    for (const action of rule.actions) {
      if (action.field === "setPayee") next.payeeName = action.value;
      if (action.field === "setCategory") {
        next.categoryId = action.value.length > 0 ? action.value : null;
        next.categoryName = context.categoryNames.get(action.value) ?? "";
      }
      if (action.field === "setMemo") next.memo = action.value;
      if (action.field === "setFlag") next.flag = asFlag(action.value);
      if (action.field === "setCleared") next.cleared = asCleared(action.value);
    }
  }

  return { draft: next, matchedRuleIds };
}

function matches(draft: RuleDraft, condition: RuleCondition, context: RuleContext): boolean {
  if (condition.field === "amount") {
    return matchesAmount(draft.amountMinor, condition, context);
  }
  return matchAny(fieldValues(draft, condition.field), condition);
}

/**
 * A record can be named by id or by the text a person sees. The rule editor takes the id for a
 * category action but a typed name for a condition, so both have to count for `category` and
 * `account`; matching only the id made every name-typed condition silently false.
 */
function fieldValues(draft: RuleDraft, field: RuleCondition["field"]): string[] {
  if (field === "importedPayee") return [draft.importedPayee];
  if (field === "payee") return [draft.payeeName];
  if (field === "account") return identifiers(draft.accountId, draft.accountName);
  if (field === "category") return identifiers(draft.categoryId, draft.categoryName);
  if (field === "date") return [draft.date];
  if (field === "memo") return [draft.memo];
  if (field === "cleared") return [draft.cleared];
  return [""];
}

function identifiers(...values: (string | null)[]): string[] {
  const present = values.filter((value): value is string => Boolean(value && value.length > 0));
  return present.length > 0 ? present : [""];
}

/**
 * Positive operators match when any candidate does; negative ones only when every candidate
 * does. `account isNot Checking` must stay false for a record whose name is Checking even
 * though its id differs from the typed text.
 */
function matchAny(values: readonly string[], condition: RuleCondition): boolean {
  const positive =
    condition.op === "is" ||
    condition.op === "contains" ||
    condition.op === "oneOf" ||
    condition.op === "matches";
  return positive
    ? values.some((value) => compare(value, condition.op, condition.value))
    : values.every((value) => compare(value, condition.op, condition.value));
}

function matchesAmount(
  amountMinor: number,
  condition: RuleCondition,
  context: RuleContext,
): boolean {
  if (condition.op === "oneOf" || condition.op === "notOneOf") {
    const values = condition.value
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => parseMoney(part, context.currency, context.currencyScale));
    if (values.length > 0 && values.every((parsed) => parsed.isOk())) {
      const match = values.some((parsed) => parsed.isOk() && parsed.value === amountMinor);
      return condition.op === "oneOf" ? match : !match;
    }
  }
  const parsed = parseMoney(condition.value, context.currency, context.currencyScale);
  if (parsed.isOk()) return compareNumber(amountMinor, condition.op, parsed.value);
  return compare(String(amountMinor), condition.op, condition.value);
}

function compareNumber(actual: number, op: RuleOperator, expected: number): boolean {
  if (op === "is") return actual === expected;
  if (op === "isNot") return actual !== expected;
  if (op === "oneOf") return actual === expected;
  if (op === "notOneOf") return actual !== expected;
  return false;
}

function compare(actual: string, op: RuleOperator, expected: string): boolean {
  const left = actual.toLowerCase();
  const right = expected.toLowerCase();
  if (op === "is") return left === right;
  if (op === "isNot") return left !== right;
  if (op === "contains") return left.includes(right);
  if (op === "doesNotContain") return !left.includes(right);
  if (op === "oneOf") return splitValues(expected).some((value) => value.toLowerCase() === left);
  if (op === "notOneOf")
    return splitValues(expected).every((value) => value.toLowerCase() !== left);
  if (op === "matches") {
    try {
      return new RegExp(expected, "i").test(actual);
    } catch {
      return false;
    }
  }
  return false;
}

function splitValues(value: string): string[] {
  return value
    .split("|")
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function asFlag(value: string): TransactionFlag | null {
  const flags: TransactionFlag[] = ["red", "orange", "yellow", "green", "blue", "purple"];
  return flags.includes(value as TransactionFlag) ? (value as TransactionFlag) : null;
}

function asCleared(value: string): ClearedStatus {
  if (value === "cleared" || value === "reconciled") return value;
  return "uncleared";
}
