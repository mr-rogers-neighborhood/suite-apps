import type { PackCapability } from "@suite/go";
import { CAPABILITY_TITLES } from "../host/consent.js";

/**
 * The one consent dialog (S4.2).
 *
 * Every capability the record asks about comes through here, so there is one
 * sentence, one allow and one deny. The person's answer is what the record keeps;
 * this component remembers nothing.
 */
export function ConsentSheet({
  open,
  packName,
  capability,
  reason,
  onAnswer,
}: {
  readonly open: boolean;
  readonly packName: string;
  readonly capability: PackCapability | null;
  readonly reason: string;
  readonly onAnswer: (granted: boolean) => void;
}) {
  if (!open || capability === null) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${packName} permission`}
        className="relative z-10 flex flex-col gap-4 rounded-t-2xl border-t border-[var(--hairline)] bg-[var(--canvas)] p-5 shadow-2xl"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-[var(--hairline)]" aria-hidden="true" />
        <h2 className="text-[17px] font-semibold text-[var(--ink)]">
          {CAPABILITY_TITLES[capability] ?? `Allow ${capability}?`}
        </h2>
        <p className="text-[14px] text-[var(--ink)]">
          {packName} wants to {reason}.
        </p>
        <p className="text-[13px] text-[var(--ink-muted)]">
          This answer is remembered for this version. A denial is remembered too; you can ask again
          from Settings → Apps.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="touch flex-1 rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)]"
            onClick={() => onAnswer(false)}
          >
            Don't allow
          </button>
          <button
            type="button"
            className="touch flex-1 rounded-xl bg-[var(--accent)] px-4 text-[15px] font-medium text-[var(--on-accent)]"
            onClick={() => onAnswer(true)}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
