import { formatMoney } from "@suite/budget-core";
import { Button } from "@suite/ui";
import { Undo2 } from "lucide-react";
import { useState } from "react";

import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";

/**
 * The review notice for an automatic-entry batch. The batch is a document record, so the
 * notice and its undo are still here after the app is closed and opened again.
 */
export function ScheduleAutoEnterNotice() {
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const [error, setError] = useState<string | null>(null);
  const batch = snapshot.scheduleBatches.find((candidate) => candidate.undoneAt === null);

  if (!batch) return null;

  const count = batch.transactionIds.length;
  const total = formatMoney(
    batch.totalAmountMinor,
    snapshot.settings.currency,
    undefined,
    snapshot.settings.currencyScale,
  );

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-line bg-raised px-4 py-2 text-[12px] text-muted"
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium text-ink">
          Added {count} scheduled {count === 1 ? "transaction" : "transactions"}
        </span>{" "}
        totalling <span className="tnum text-ink">{total}</span>.
      </span>
      {error ? (
        <span role="alert" className="text-danger">
          {error}
        </span>
      ) : null}
      <Button
        size="sm"
        onClick={() => {
          try {
            replica.document.undoScheduleBatch(batch.id);
            setError(null);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not undo the batch");
          }
        }}
      >
        <Undo2 size={12} />
        Undo
      </Button>
    </div>
  );
}
