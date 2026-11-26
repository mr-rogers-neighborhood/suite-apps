import { type ReactNode } from "react";
/**
 * The new-tab picker.
 *
 * A new tab is a question — which surface? — and the answer belongs in one searchable list:
 * the installed packs, the person's Screens, and the two host actions that create a surface.
 * The picker is presentation only. The host owns the tab list, the pack frames and the choice
 * of what "open" means.
 *
 * It uses the ARIA combobox/listbox pattern with `aria-activedescendant`: focus stays in the
 * input, so typing never competes with arrow keys. Enter opens the active row, Escape and the
 * backdrop close (Radix `Modal` owns both), and a disabled row is skipped by the keyboard.
 */
export interface NewTabPack {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    /** The pack's card icon, or an `AppMark`. */
    readonly icon?: ReactNode;
    /** Installed, but this build cannot draw it. It stays visible and refuses activation. */
    readonly unavailable?: boolean;
}
export interface NewTabScreen {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
}
export interface NewTabPickerProps {
    readonly open: boolean;
    readonly packs: readonly NewTabPack[];
    readonly screens: readonly NewTabScreen[];
    readonly onClose: () => void;
    readonly onOpenPack: (id: string) => void;
    readonly onOpenScreen: (id: string) => void;
    readonly onNewScreen: () => void;
    readonly onOpenSettings: () => void;
    /** A query to start from, for a story or a test. The list is not filtered on first paint. */
    readonly initialQuery?: string;
    readonly "data-testid"?: string;
}
export declare function NewTabPicker({ open, packs, screens, onClose, onOpenPack, onOpenScreen, onNewScreen, onOpenSettings, initialQuery, "data-testid": testId, }: NewTabPickerProps): ReactNode;
//# sourceMappingURL=NewTabPicker.d.ts.map