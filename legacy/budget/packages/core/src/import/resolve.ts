import { READY_TO_ASSIGN, READY_TO_ASSIGN_NAME } from "../schema";
import type { ImportRow } from "./types";

/**
 * The reserved category an import row names, or null when the name is ordinary text the caller
 * should look up or create. The comparison is case-insensitive so an export re-imports as income
 * even when someone lowercased the name in a spreadsheet.
 */
export function reservedCategoryId(name: string | null): string | null {
  if (name === null) return null;
  return name.trim().toLowerCase() === READY_TO_ASSIGN_NAME.toLowerCase() ? READY_TO_ASSIGN : null;
}

export type ImportTransferDirection = "outbound" | "inbound" | "other-leg";

/**
 * Which way a QIF transfer row moves money, from the register being imported into.
 *
 * A QIF row belongs to the selected account, so the amount's sign says the direction: negative
 * left the account, positive entered it. A row whose `[Account]` target is the account being
 * imported into is the other side of a whole-budget export, and importing it would make the
 * account transfer to itself, so it is the leg to drop.
 */
export function transferDirection(
  row: ImportRow,
  accountName: string,
): ImportTransferDirection | null {
  if (row.transferAccountName === null) return null;
  const target = row.transferAccountName.trim().toLowerCase();
  if (target === accountName.trim().toLowerCase()) return "other-leg";
  return row.amountMinor < 0 ? "outbound" : "inbound";
}
