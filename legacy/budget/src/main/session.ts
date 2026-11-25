import type { BudgetDocument, LibraryEntry } from "@suite/budget-core";
import type { AppPaths } from "./budgetLocation";
import { BudgetStore } from "./budgetStore";

let current: BudgetStore | null = null;

export function requireStore(): BudgetStore {
  if (!current) throw new Error("No budget is open");
  return current;
}

export async function openSession(
  paths: AppPaths,
  entry: LibraryEntry,
  doc: BudgetDocument,
): Promise<BudgetStore> {
  await closeSession();
  current = BudgetStore.fromDocument(paths, entry, doc);
  try {
    // The authority catches up on opening, once, before the renderer sees a snapshot.
    // A schedule that is not due writes nothing, so an ordinary open stays untouched.
    const result = doc.autoEnterSchedules();
    if (result.batch || result.skippedBefore > 0) current.scheduleSave();
  } catch (error) {
    // A schedule problem must not stop a budget from opening.
    console.error("Suite Budget: could not catch up scheduled entries", error);
  }
  return current;
}

export async function closeSession(): Promise<void> {
  const store = current;
  current = null;
  if (store) await store.close();
}
