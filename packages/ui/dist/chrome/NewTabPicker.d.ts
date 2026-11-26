import { type ReactNode } from "react";
/** One document the host can open. */
export interface NewTabDocument {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    /** Epoch milliseconds when the host recorded the open. Absent means it has none. */
    readonly openedAt?: number;
}
/** What a pack calls one of its documents. */
export interface NewTabNoun {
    readonly singular: string;
    readonly plural: string;
}
export interface NewTabPack {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    /** The pack's mark, or an `AppMark`. */
    readonly icon?: ReactNode;
    /** Installed, but this build cannot draw it. It stays visible and refuses activation. */
    readonly unavailable?: boolean;
    /**
     * The word this pack uses for a document ("Canvas" / "Canvases"), declared in its manifest.
     * Absent means the neutral "document".
     */
    readonly noun?: NewTabNoun;
    /**
     * Every document the host can list for this pack. Empty or absent means the pack opens
     * directly and the picker never shows a second level for it.
     */
    readonly documents?: readonly NewTabDocument[];
}
export interface NewTabScreen {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
}
/** A document that already has a tab. It is left out of Recents. */
export interface OpenDocumentRef {
    readonly packId: string;
    readonly documentId: string;
}
export type NewTabSettingsSection = "appearance" | "packs" | "sync" | "backups";
export interface NewTabPickerProps {
    readonly open: boolean;
    readonly packs: readonly NewTabPack[];
    readonly screens: readonly NewTabScreen[];
    /** Documents already open; Recents skips them because the tab strip is one click away. */
    readonly openDocuments?: readonly OpenDocumentRef[];
    readonly onClose: () => void;
    readonly onOpenPack: (id: string) => void;
    readonly onOpenDocument: (packId: string, documentId: string) => void;
    readonly onNewDocument: (packId: string) => void;
    readonly onOpenScreen: (id: string) => void;
    readonly onNewScreen: () => void;
    /** `section` lets the first-run row land on the packs list rather than the top of Settings. */
    readonly onOpenSettings: (section?: NewTabSettingsSection) => void;
    /** Present when the host can hand a file to a pack. */
    readonly onOpenFile?: () => void;
    /** A query to start from, for a story or a test. The list is filtered from the first paint. */
    readonly initialQuery?: string;
    readonly "data-testid"?: string;
}
/**
 * The new-tab picker.
 *
 * A new tab is a question — which surface? — and, when that surface holds documents, which one?
 * The answer is one dialog in two levels: packs, Screens and the host's own actions at the root;
 * a pack's documents at the second level. That shape comes from how the host stores documents:
 * the pack owns many, and opening a pack is almost always opening one of them.
 *
 * Focus never leaves the input. The list is an ARIA listbox driven by `aria-activedescendant`,
 * so typing and arrows never compete; Enter opens the active row. A pack with no documents opens
 * directly, which is how Help stays a single level without the picker knowing what Help is.
 *
 * The picker is presentation only. The host owns the tab list, the document store, the recents
 * record and what "open" means.
 */
export declare function NewTabPicker({ open, packs, screens, openDocuments, onClose, onOpenPack, onOpenDocument, onNewDocument, onOpenScreen, onNewScreen, onOpenSettings, onOpenFile, initialQuery, "data-testid": testId, }: NewTabPickerProps): ReactNode;
//# sourceMappingURL=NewTabPicker.d.ts.map