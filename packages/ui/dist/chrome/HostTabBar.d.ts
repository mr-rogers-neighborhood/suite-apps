import { type ReactNode } from "react";
/**
 * The host's tab strip on the shared `MenuBar`.
 *
 * Every host draws the same question: which surfaces are open, which one is in front, and how do
 * I open another. The strip owns that question and nothing else: the host keeps the tab list, the
 * active id and the pack frames, and hands them in. It is the navigation zone of the menu bar, so
 * a pack that draws a `MenuBar` inside its own surface is not asked to draw a second strip.
 *
 * ## Two rows, on purpose
 *
 * One row cannot hold the host's question and the active pack's material without squeezing both.
 * The host's own row keeps the marks, the tabs, search and the window controls; the pack's row is
 * a second, thinner band with the document it is showing and what that document can do. The pack
 * row does not exist when the active surface published nothing — Home costs one row, a document
 * costs two. Each row follows the host's density (`--control-height`) instead of a fixed 44px.
 *
 * A tab is a label button plus a separate close button. They are siblings rather than a button
 * inside a button, so the close control has its own accessible name and does not fire activation.
 * The list follows the tab pattern: one tab stop, arrow keys move and activate, Home/End jump,
 * Delete closes.
 */
export type HostTabKind = "pack" | "screen" | "settings" | "home";
export interface HostTab {
    readonly id: string;
    readonly title: string;
    readonly kind: HostTabKind;
    /** The app's own mark. The host passes the card icon or an `AppMark`. */
    readonly icon?: ReactNode;
    /** The surface is kept but cannot be drawn by this build; activation shows a placeholder. */
    readonly unavailable?: boolean;
}
export interface HostTabBarProps {
    readonly tabs: readonly HostTab[];
    readonly activeTabId?: string | null;
    readonly onActivate?: (id: string) => void;
    readonly onClose?: (id: string) => void;
    /** A context menu for one tab: the host adds Set as Home and Reload there. */
    readonly onTabMenu?: (id: string) => void;
    readonly onNewTab?: () => void;
    /** The suite mark. Omitted, the bar has no home anchor. */
    readonly mark?: ReactNode;
    readonly onHome?: () => void;
    readonly homeLabel?: string;
    readonly sync?: ReactNode;
    readonly controls?: ReactNode;
    /** A host-owned search trigger, in the bar's search zone. */
    readonly search?: ReactNode;
    readonly onOpenSearch?: () => void;
    readonly searchPlaceholder?: string;
    readonly searchShortcut?: string;
    /**
     * The active pack's zones, from `packMenuZones`.
     *
     * The pack fills its own row under the host's: the context says which document is in
     * front, the navigation says what it is showing, and the actions are what it can do. A
     * pack that published nothing passes no `pack`, so the row is absent rather than empty.
     */
    readonly pack?: {
        readonly context?: ReactNode;
        readonly navigation: ReactNode;
        readonly actions?: ReactNode;
    };
    /**
     * Identifies the active surface, so the pack row can play its entrance again when the
     * person switches to a different pack. Without it the row is reused and only its
     * contents swap, which reads as a flicker rather than a change.
     */
    readonly packKey?: string;
    readonly "data-testid"?: string;
}
export declare function HostTabBar({ tabs, activeTabId, onActivate, onClose, onTabMenu, onNewTab, mark, onHome, homeLabel, sync, controls, search, onOpenSearch, searchPlaceholder, searchShortcut, pack, packKey, "data-testid": testId, }: HostTabBarProps): ReactNode;
//# sourceMappingURL=HostTabBar.d.ts.map