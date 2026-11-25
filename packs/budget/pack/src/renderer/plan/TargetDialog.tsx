import {
  addMonths,
  buildLedger,
  ceilDivide,
  type DebtPayoffProjection,
  formatMoney,
  formatMoneyPlain,
  type MonthKey,
  monthLabel,
  monthsRemaining,
  parseMoney,
  projectDebtPayoff,
  type TargetKind,
} from "@suite/budget-core";
import { Button, Field, TextInput } from "@suite/ui";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";

const KINDS: { id: TargetKind; name: string; hint: string }[] = [
  { id: "monthly", name: "Every month", hint: "Assign the same amount each month" },
  {
    id: "needed_for_spending",
    name: "Needed for spending",
    hint: "Spread the total across the months before a due date",
  },
  {
    id: "savings_balance",
    name: "Savings balance",
    hint: "Build a balance by a date",
  },
  {
    id: "debt_payoff",
    name: "Debt payoff",
    hint: "Pay an account's balance down by a date",
  },
];

export function TargetDialog() {
  const categoryId = useUiStore((state) => state.targetCategoryId);
  const setTargetCategory = useUiStore((state) => state.setTargetCategory);
  const setNotice = useUiStore((state) => state.setNotice);
  const month = useUiStore((state) => state.month);
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const ledger = useMemo(() => buildLedger(snapshot, month), [snapshot, month]);
  const category = snapshot.categories.find((candidate) => candidate.id === categoryId);

  const [kind, setKind] = useState<TargetKind>("monthly");
  const [amount, setAmount] = useState("0.00");
  const [dueMonth, setDueMonth] = useState(month);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryId) return;
    const existing = replica.document.activeTarget(categoryId, month);
    setKind(existing?.kind ?? "monthly");
    setAmount(
      existing ? formatMoneyPlain(existing.amountMinor, snapshot.settings.currencyScale) : "0.00",
    );
    setDueMonth(existing?.dueMonth ?? month);
    setAccountId(existing?.accountId ?? "");
    setError(null);
  }, [categoryId, month, replica, snapshot.settings.currencyScale]);

  if (!category) return null;
  const accounts = snapshot.accounts.filter(
    (account) => !account.closedAt && (account.type === "credit" || account.type === "loan"),
  );

  const linkedAccount = accountId
    ? snapshot.accounts.find((account) => account.id === accountId)
    : undefined;
  const debtMinor = accountId
    ? Math.max(0, -(ledger.balanceByMonth.get(month)?.get(accountId) ?? 0))
    : 0;
  const monthlyNeedMinor = ceilDivide(debtMinor, monthsRemaining(month, dueMonth));
  const projection =
    kind === "debt_payoff" && accountId
      ? projectDebtPayoff({
          balanceMinor: debtMinor,
          annualRateBps: linkedAccount?.loan?.interestRateBps ?? 0,
          monthlyPaymentMinor: monthlyNeedMinor,
        })
      : null;

  const save = (): void => {
    const parsed = parseMoney(amount, snapshot.settings.currency, snapshot.settings.currencyScale);
    if (parsed.isErr() || parsed.value <= 0) {
      setError("Enter a positive amount");
      return;
    }
    if (kind !== "monthly" && !dueMonth) {
      setError("Choose a due month");
      return;
    }
    if (kind === "debt_payoff" && !accountId) {
      setError("Choose the account to pay off");
      return;
    }
    try {
      replica.document.setTarget(
        category.id,
        {
          kind,
          amountMinor: parsed.value,
          dueMonth: kind === "monthly" ? null : dueMonth,
          accountId: kind === "debt_payoff" ? accountId : null,
        },
        month,
      );
      setNotice(`Target saved for ${category.name}`);
      setTargetCategory(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const clear = (): void => {
    replica.document.clearTarget(category.id, month);
    setNotice(`Target cleared for ${category.name}`);
    setTargetCategory(null);
  };

  return (
    <Modal
      open={categoryId !== null}
      onOpenChange={(open) => {
        if (!open) setTargetCategory(null);
      }}
      title={`Target · ${category.name}`}
      description="A target is a suggestion. The app never moves money for you."
      footer={
        <>
          <Button onClick={clear}>Clear target</Button>
          <Button onClick={() => setTargetCategory(null)}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save target
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Target type">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as TargetKind)}
            className="h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] text-ink"
          >
            {KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="-mt-2 text-[11px] text-faint">
          {KINDS.find((item) => item.id === kind)?.hint}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "savings_balance" ? "Target balance" : "Amount"}>
            <TextInput
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          {kind !== "monthly" ? (
            <Field label="By month">
              <input
                type="month"
                value={dueMonth}
                onChange={(event) => setDueMonth(event.target.value)}
                className="h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] text-ink"
              />
            </Field>
          ) : null}
        </div>

        {kind === "debt_payoff" ? (
          <Field label="Account">
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] text-ink"
            >
              <option value="">Choose an account…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ·{" "}
                  {formatMoney(
                    replica.document.accountBalance(account.id),
                    snapshot.settings.currency,
                    undefined,
                    snapshot.settings.currencyScale,
                  )}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {projection ? (
          <DebtEstimate
            projection={projection}
            monthlyNeedMinor={monthlyNeedMinor}
            month={month}
            currency={snapshot.settings.currency}
            scale={snapshot.settings.currencyScale}
          />
        ) : null}

        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}

function DebtEstimate({
  projection,
  monthlyNeedMinor,
  month,
  currency,
  scale,
}: {
  projection: DebtPayoffProjection;
  monthlyNeedMinor: number;
  month: MonthKey;
  currency: string;
  scale: number;
}) {
  const money = (value: number) => formatMoney(value, currency, undefined, scale);
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-[12px] leading-relaxed">
      {projection.status === "already-paid-off" ? (
        <p className="text-ink">This account has no balance left to pay off.</p>
      ) : projection.status === "never-pays-off" ? (
        <p className="text-danger">
          {projection.reason === "beyond-horizon"
            ? `At ${money(monthlyNeedMinor)} a month this balance would take more than 100 years to clear.`
            : `At ${money(monthlyNeedMinor)} a month this balance never goes down; about ${money(projection.monthlyInterestMinor)} a month goes to interest.`}
        </p>
      ) : (
        <>
          <p className="text-ink">
            Estimated payoff in {projection.monthsToPayoff}{" "}
            {projection.monthsToPayoff === 1 ? "month" : "months"}, around{" "}
            {monthLabel(addMonths(month, projection.monthsToPayoff - 1))} at{" "}
            {money(monthlyNeedMinor)} a month.
          </p>
          <p className="text-muted">
            Estimated interest {money(projection.totalInterestMinor)}; total paid{" "}
            {money(projection.totalPaidMinor)}.
          </p>
        </>
      )}
      <p className="mt-1 text-[11px] text-faint">
        An estimate only. New charges and rate changes are not modelled.
      </p>
    </div>
  );
}
