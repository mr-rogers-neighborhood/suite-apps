import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";
import { cx } from "./cx.js";
import { EmptyState } from "./EmptyState.js";
import { FOCUS_RING, INK, MOTION, SURFACE } from "./tokens.js";

/**
 * One row. The content is the caller's: a label, a secondary line, a chip.
 *
 * Keep interactive controls out of `content`. A row is a single `option`, so a button inside it
 * would be an interactive control inside an interactive control; put row actions in the
 * `DetailView` the row opens.
 */
export interface ListViewItem {
  readonly id: string;
  /** The row's visible content. */
  readonly content: ReactNode;
  /** An accessible name when `content` is not enough on its own, such as an icon-only row. */
  readonly label?: string;
  /** A disabled row is skipped by the keyboard and cannot be selected. */
  readonly disabled?: boolean;
}

/** A named group of rows. The name is both visible and the group's accessible name. */
export interface ListViewSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly ListViewItem[];
}

export interface ListViewProps extends Omit<ComponentProps<"div">, "onSelect" | "children"> {
  /** The listbox's accessible name. Required: an unnamed listbox is announced as "list". */
  readonly label: string;
  /** Unsectioned rows. Ignored when `sections` is given. */
  readonly items?: readonly ListViewItem[];
  /** Named groups of rows. Takes precedence over `items`. */
  readonly sections?: readonly ListViewSection[];
  /** The selected row. Selection is controlled; the list never keeps its own copy. */
  readonly selectedId?: string | null;
  /** Called when a row is clicked or reached with an arrow key. Selection follows focus. */
  readonly onSelect?: (id: string) => void;
  /** Called when Enter opens the focused row. */
  readonly onActivate?: (id: string) => void;
  /** Replaces the default `EmptyState`. */
  readonly empty?: ReactNode;
  readonly className?: string;
}

/**
 * A single-select list of rows.
 *
 * The pattern is a listbox because the job is selection plus traversal: one row is current, the
 * arrow keys move it, Home and End jump to the ends, and Enter opens it. That is a listbox's
 * contract rather than a list of buttons with keys bolted on, and it is the version a screen
 * reader can describe. Selection is controlled (`selectedId` plus `onSelect`) for the same
 * reason `AppShell` owns no state: the caller already has the selected item, and a second copy
 * inside the component is a second truth.
 *
 * Rows with no `items` and no `sections` render the shared `EmptyState`, not an empty listbox:
 * a `listbox` with no options has no valid accessible description.
 */
export function ListView({
  label,
  items,
  sections,
  selectedId = null,
  onSelect,
  onActivate,
  empty,
  className,
  onKeyDown,
  ...props
}: ListViewProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const rows =
    sections === undefined ? (items ?? []) : sections.flatMap((section) => section.items);
  if (rows.length === 0) {
    return (
      <div className={cx(className)} data-empty="true" {...props}>
        {empty ?? <EmptyState title="Nothing here yet" />}
      </div>
    );
  }

  // The row that Tab lands on: the selected row when it is selectable, otherwise the first
  // enabled row. Every other row is a programmatic target only, which is the roving tab stop
  // the listbox pattern asks for.
  const firstEnabled = rows.find((item) => item.disabled !== true);
  const selectedIsSelectable = rows.some(
    (item) => item.id === selectedId && item.disabled !== true,
  );
  const tabStopId = selectedIsSelectable ? selectedId : firstEnabled?.id;

  function options(): HTMLElement[] {
    const root = listRef.current;
    if (root === null) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>('[data-list-item="true"]:not([aria-disabled="true"])'),
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    // Keys pressed inside a row's content belong to that control, not to the list.
    if (!(target instanceof HTMLElement) || target.dataset.listItem !== "true") return;

    const enabled = options();
    const current = enabled.indexOf(target);
    if (current < 0) return;

    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = (current + 1) % enabled.length;
        break;
      case "ArrowUp":
        next = current === 0 ? enabled.length - 1 : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = enabled.length - 1;
        break;
      case "Enter":
        event.preventDefault();
        if (target.dataset.itemId !== undefined) onActivate?.(target.dataset.itemId);
        return;
      case " ":
        event.preventDefault();
        if (target.dataset.itemId !== undefined) onSelect?.(target.dataset.itemId);
        return;
      default:
        return;
    }

    event.preventDefault();
    const destination = enabled[next];
    if (destination === undefined) return;
    destination.focus();
    if (destination.dataset.itemId !== undefined) onSelect?.(destination.dataset.itemId);
  }

  function renderRow(item: ListViewItem, groupId: string) {
    const isSelected = item.id === selectedId;
    return (
      <div
        key={`${groupId}:${item.id}`}
        role="option"
        aria-selected={isSelected}
        aria-disabled={item.disabled === true ? true : undefined}
        aria-label={item.label}
        tabIndex={item.id === tabStopId ? 0 : -1}
        data-list-item="true"
        data-item-id={item.id}
        data-selected={isSelected ? "true" : undefined}
        onClick={(event) => {
          if (item.disabled === true) return;
          event.currentTarget.focus();
          onSelect?.(item.id);
        }}
        className={cx(
          "flex w-full select-none items-center gap-[var(--control-gap,0.5rem)] rounded-md px-[var(--control-padding-x,0.75rem)] py-[var(--row-padding-y,0.625rem)] text-left text-[length:var(--text-body,13px)]",
          MOTION,
          FOCUS_RING,
          isSelected
            ? cx(SURFACE.sunk, INK.base)
            : cx("bg-transparent", INK.base, "hover:bg-[var(--surface-sunk)]"),
          item.disabled === true ? "cursor-not-allowed opacity-50" : "cursor-default",
        )}
      >
        {item.content}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) handleKeyDown(event);
      }}
      className={cx("flex flex-col gap-0.5", className)}
      {...props}
    >
      {sections === undefined
        ? (items ?? []).map((item) => renderRow(item, "items"))
        : sections.map((section) => (
            <div
              key={section.id}
              role="group"
              aria-label={section.title}
              className="flex flex-col gap-0.5"
            >
              {/* The group's aria-label already names it; the visible label is decoration. */}
              <div
                aria-hidden="true"
                className={cx(
                  "px-[var(--control-padding-x,0.75rem)] pb-1 pt-2 text-[length:var(--text-caption,11px)] font-medium uppercase tracking-wide",
                  INK.faint,
                )}
              >
                {section.title}
              </div>
              {section.items.map((item) => renderRow(item, section.id))}
            </div>
          ))}
    </div>
  );
}
