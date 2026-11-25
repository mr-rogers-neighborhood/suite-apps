import { partsOfDateKey } from "../dates";
import { formatMoneyPlain } from "../money";
import {
  type BudgetSnapshot,
  READY_TO_ASSIGN,
  READY_TO_ASSIGN_NAME,
  type Transaction,
} from "../schema";

export function transactionsToCsv(snapshot: BudgetSnapshot): string {
  const accounts = new Map(snapshot.accounts.map((account) => [account.id, account.name]));
  const payees = new Map(snapshot.payees.map((payee) => [payee.id, payee.name]));
  const categories = new Map(snapshot.categories.map((category) => [category.id, category.name]));
  const scale = snapshot.settings.currencyScale;
  const parents = new Set(
    snapshot.transactions
      .map((transaction) => transaction.parentId)
      .filter((id): id is string => id !== null),
  );
  const lines = ["Date,Account,Payee,Category,Memo,Amount,Cleared,Flag"];

  const write = (transaction: Transaction, category: string): void => {
    lines.push(
      [
        transaction.date,
        accounts.get(transaction.accountId) ?? "",
        payees.get(transaction.payeeId ?? "") ?? transaction.payeeName,
        category,
        transaction.memo,
        formatMoneyPlain(transaction.amountMinor, scale),
        transaction.cleared,
        transaction.flag ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  };

  for (const transaction of snapshot.transactions) {
    if (transaction.parentId !== null) continue;
    if (parents.has(transaction.id)) {
      for (const child of snapshot.transactions) {
        if (child.parentId !== transaction.id) continue;
        write(child, categories.get(child.categoryId ?? "") ?? "Split");
      }
      continue;
    }
    write(
      transaction,
      transaction.categoryId === READY_TO_ASSIGN
        ? READY_TO_ASSIGN_NAME
        : (categories.get(transaction.categoryId ?? "") ?? ""),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function transactionsToQif(snapshot: BudgetSnapshot): string {
  const accounts = new Map(snapshot.accounts.map((account) => [account.id, account.name]));
  const categories = new Map(snapshot.categories.map((category) => [category.id, category.name]));
  const scale = snapshot.settings.currencyScale;
  const parents = new Set(
    snapshot.transactions
      .map((transaction) => transaction.parentId)
      .filter((id): id is string => id !== null),
  );
  const lines = ["!Type:Bank"];

  for (const transaction of snapshot.transactions) {
    if (transaction.parentId !== null) continue;
    const { year, month, day } = partsOfDateKey(transaction.date);
    lines.push(`D${month}/${day}/${year}`);
    lines.push(`T${formatMoneyPlain(transaction.amountMinor, scale)}`);
    const payee = qifText(transaction.payeeName);
    if (payee) lines.push(`P${payee}`);
    const memo = qifText(transaction.memo);
    if (memo) lines.push(`M${memo}`);
    if (transaction.transferAccountId) {
      lines.push(`L[${qifText(accounts.get(transaction.transferAccountId) ?? "")}]`);
    } else if (transaction.categoryId === READY_TO_ASSIGN) {
      // Income has no category record. Writing the reserved name keeps Ready to Assign intact
      // when the file is read back, instead of turning income into an uncategorized row.
      lines.push(`L${READY_TO_ASSIGN_NAME}`);
    } else if (transaction.categoryId) {
      lines.push(`L${qifText(categories.get(transaction.categoryId) ?? "")}`);
    }
    const externalId = transaction.imported?.externalId;
    if (externalId) lines.push(`N${qifText(externalId)}`);
    if (transaction.cleared === "reconciled") lines.push("CR");
    else if (transaction.cleared === "cleared") lines.push("C*");

    if (parents.has(transaction.id)) {
      for (const child of snapshot.transactions) {
        if (child.parentId !== transaction.id) continue;
        lines.push(`S${qifText(categories.get(child.categoryId ?? "") ?? "")}`);
        const childMemo = qifText(child.memo);
        if (childMemo) lines.push(`E${childMemo}`);
        lines.push(`$${formatMoneyPlain(child.amountMinor, scale)}`);
      }
    }
    lines.push("^");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * QIF is line-based, so a payee, memo, category or account name with a line break would become
 * a new field line and could end the record early. Collapse the break to a space and keep the
 * person's text on its own row.
 */
function qifText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
