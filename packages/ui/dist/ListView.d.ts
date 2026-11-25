import type { ComponentProps, ReactNode } from "react";
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
export declare function ListView({ label, items, sections, selectedId, onSelect, onActivate, empty, className, onKeyDown, ...props }: ListViewProps): import("react").JSX.Element;
//# sourceMappingURL=ListView.d.ts.map