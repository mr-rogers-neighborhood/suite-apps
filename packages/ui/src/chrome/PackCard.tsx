import { cx } from "../cx.js";
import { EDGE, FOCUS_RING, INK, MOTION, SURFACE } from "../tokens.js";

/** What the card says about the pack's install state, in one word. */
export type PackStatus = "installed" | "update" | "available" | "unavailable";

export interface PackCardProps {
  readonly name: string;
  readonly description?: string;
  /** The pack card's icon, as a data URI. Absent draws the pack's initial. */
  readonly icon?: string;
  readonly status?: PackStatus;
  readonly version?: string;
  /** The card is the one whose details the rail is showing. */
  readonly selected?: boolean;
  readonly onSelect: () => void;
}

const STATUS_LABEL: Record<PackStatus, string> = {
  installed: "Installed",
  update: "Update",
  available: "Available",
  unavailable: "Unavailable",
};

/**
 * One pack in a host's catalogue.
 *
 * The card is a chooser, not a launcher: choosing it shows the pack's details and its one action
 * in the rail, which is where versions, publishers and capabilities live. A person scanning Home
 * should see a mark, a name and a sentence — not a fingerprint.
 */
export function PackCard({
  name,
  description,
  icon,
  status = "available",
  version,
  selected = false,
  onSelect,
}: PackCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        "group flex w-full items-start gap-3 rounded-lg border p-3 text-left",
        selected
          ? "border-[var(--accent)] bg-[var(--surface-strong)]"
          : cx(EDGE.hairline, SURFACE.base),
        "hover:bg-[var(--surface-sunk)]",
        MOTION,
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md",
          SURFACE.sunk,
          INK.muted,
        )}
      >
        {icon === undefined ? (
          <span className="text-[length:var(--text-title,15px)]">
            {name.trim().slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <img src={icon} alt="" className="h-6 w-6 object-contain" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cx(
              "min-w-0 flex-1 truncate text-[length:var(--text-title,15px)]",
              INK.base,
            )}
          >
            {name}
          </span>
          {version === undefined ? null : (
            <span className={cx("shrink-0 text-[length:var(--text-caption,11px)]", INK.faint)}>
              {version}
            </span>
          )}
        </span>
        {description === undefined ? null : (
          <span
            className={cx(
              "mt-0.5 block text-[length:var(--text-label,12px)] leading-relaxed",
              INK.muted,
            )}
          >
            {description}
          </span>
        )}
        <span
          className={cx(
            "mt-2 block text-[length:var(--text-caption,11px)]",
            status === "installed" ? INK.muted : INK.faint,
            status === "update" ? "text-[var(--accent)]" : undefined,
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </span>
    </button>
  );
}
