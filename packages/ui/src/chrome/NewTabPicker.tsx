import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cx } from "../cx.js";
import { Modal } from "../Modal.js";
import { FOCUS_RING, INK, MOTION, SURFACE } from "../tokens.js";

/** How many documents a Recent section shows. */
const RECENT_LIMIT = 5;

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

interface PickerItem {
  readonly key: string;
  readonly group: string;
  /** Lower ranks come first; the order inside a rank is the order pushed. */
  readonly rank: number;
  readonly label: string;
  readonly description?: string | undefined;
  readonly icon?: ReactNode;
  readonly disabled: boolean;
  /** A note at the end of the row: a count, or "unavailable". */
  readonly hint?: string;
  /** A pack whose second level this row opens instead of running. */
  readonly drill?: string;
  readonly run: () => void;
}

const NEUTRAL_NOUN: NewTabNoun = { singular: "document", plural: "documents" };

function nounFor(pack: NewTabPack): NewTabNoun {
  return pack.noun ?? NEUTRAL_NOUN;
}

function documentKey(packId: string, documentId: string): string {
  return `${packId}\u0000${documentId}`;
}

function byRecent(left: NewTabDocument, right: NewTabDocument): number {
  return (right.openedAt ?? 0) - (left.openedAt ?? 0);
}

function byName(left: NewTabDocument, right: NewTabDocument): number {
  return left.name.localeCompare(right.name);
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
export function NewTabPicker({
  open,
  packs,
  screens,
  openDocuments,
  onClose,
  onOpenPack,
  onOpenDocument,
  onNewDocument,
  onOpenScreen,
  onNewScreen,
  onOpenSettings,
  onOpenFile,
  initialQuery = "",
  "data-testid": testId = "new-tab-picker",
}: NewTabPickerProps): ReactNode {
  const [query, setQuery] = useState(initialQuery);
  const [level, setLevel] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const openKeys = new Set(
    (openDocuments ?? []).map((entry) => documentKey(entry.packId, entry.documentId)),
  );
  const pack = level === null ? undefined : packs.find((row) => row.id === level);
  const noun = pack === undefined ? NEUTRAL_NOUN : nounFor(pack);
  const documents = pack?.documents ?? [];

  useEffect(() => {
    if (!open) return;
    setLevel(null);
    setQuery(initialQuery);
    setActive(0);
    // Radix focuses the first control, which is the input; this keeps the intent explicit for
    // a caller that mounts the dialog already open.
    input.current?.focus();
  }, [open, initialQuery]);

  useEffect(() => {
    setActive(0);
  }, [query, level]);

  function rootItems(): PickerItem[] {
    const items: PickerItem[] = [];
    const needle = query.trim().toLowerCase();

    if (needle.length === 0) {
      const recents = packs
        .flatMap((owner) =>
          (owner.documents ?? [])
            .filter(
              (document) =>
                document.openedAt !== undefined &&
                !openKeys.has(documentKey(owner.id, document.id)),
            )
            .map((document) => ({ owner, document })),
        )
        .sort((left, right) => byRecent(left.document, right.document))
        .slice(0, RECENT_LIMIT);

      for (const { owner, document } of recents) {
        items.push({
          key: `recent:${owner.id}:${document.id}`,
          group: "Recents",
          rank: 1,
          label: document.name,
          description:
            document.description === undefined
              ? owner.name
              : `${owner.name} · ${document.description}`,
          icon: owner.icon,
          disabled: false,
          run: () => onOpenDocument(owner.id, document.id),
        });
      }
    }

    for (const row of packs) {
      const count = (row.documents ?? []).length;
      items.push({
        key: `pack:${row.id}`,
        group: "Packs",
        rank: 2,
        label: row.name,
        description: row.description,
        icon: row.icon,
        disabled: row.unavailable === true,
        ...(count > 0 && row.unavailable !== true
          ? { drill: row.id, hint: `${String(count)} ${nounFor(row).plural.toLowerCase()}` }
          : {}),
        run: () => onOpenPack(row.id),
      });
    }

    if (needle.length > 0) {
      // The root only lists recent documents, so a query is the one way to reach the rest
      // without choosing a pack first. Each hit carries its pack, because the row alone would
      // not say which app it belongs to.
      const hits = packs
        .flatMap((owner) =>
          (owner.documents ?? []).map((document) => ({ owner, document })),
        )
        .sort((left, right) => byRecent(left.document, right.document));

      for (const { owner, document } of hits) {
        items.push({
          key: `document:${owner.id}:${document.id}`,
          group: "Documents",
          rank: 3,
          label: document.name,
          description:
            document.description === undefined
              ? owner.name
              : `${owner.name} · ${document.description}`,
          icon: owner.icon,
          disabled: false,
          run: () => onOpenDocument(owner.id, document.id),
        });
      }
    }

    for (const screen of screens) {
      items.push({
        key: `screen:${screen.id}`,
        group: "Screens",
        rank: 4,
        label: screen.name,
        description: screen.description,
        disabled: false,
        run: () => onOpenScreen(screen.id),
      });
    }
    items.push({
      key: "action:new-screen",
      group: "Screens",
      rank: 4,
      label: "New screen",
      description: "Compose a new Screen",
      disabled: false,
      run: onNewScreen,
    });

    if (onOpenFile !== undefined) {
      items.push({
        key: "action:open-file",
        group: "Host",
        rank: 5,
        label: "Open a file…",
        description: "Open a file this machine already holds",
        disabled: false,
        run: onOpenFile,
      });
    }
    items.push({
      key: "action:settings",
      group: "Host",
      rank: 5,
      label: "Settings",
      description: "Appearance, packs, sync and backups",
      disabled: false,
      run: () => onOpenSettings(),
    });

    if (packs.length === 0) {
      items.push({
        key: "action:install-pack",
        group: "Start",
        rank: 0,
        label: "Install a pack",
        description: "Choose a .suitepack this machine already holds",
        disabled: false,
        run: () => onOpenSettings("packs"),
      });
    }

    return items;
  }

  function packItems(owner: NewTabPack): PickerItem[] {
    const items: PickerItem[] = [];
    const ownerNoun = nounFor(owner);
    const all = owner.documents ?? [];
    const recents = all
      .filter(
        (document) =>
          document.openedAt !== undefined &&
          !openKeys.has(documentKey(owner.id, document.id)),
      )
      .sort(byRecent)
      .slice(0, RECENT_LIMIT);
    const recentKeys = new Set(recents.map((document) => document.id));

    const row = (document: NewTabDocument, group: string, rank: number): PickerItem => ({
      key: `document:${owner.id}:${document.id}`,
      group,
      rank,
      label: document.name,
      description: document.description,
      icon: owner.icon,
      disabled: false,
      run: () => onOpenDocument(owner.id, document.id),
    });

    for (const document of recents) {
      items.push(row(document, `Recent ${ownerNoun.plural}`, 1));
    }
    for (const document of all.filter((entry) => !recentKeys.has(entry.id)).sort(byName)) {
      items.push(row(document, ownerNoun.plural, 2));
    }

    items.push({
      key: `new:${owner.id}`,
      group: "Host",
      rank: 3,
      label: `New ${ownerNoun.singular}`,
      disabled: false,
      run: () => onNewDocument(owner.id),
    });

    return items;
  }

  const source = pack === undefined ? rootItems() : packItems(pack);
  const needle = query.trim().toLowerCase();
  const visible = (
    needle.length === 0
      ? source
      : source.filter((item) =>
          `${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle),
        )
  )
    .slice()
    .sort((left, right) => left.rank - right.rank);

  const activeIndex = Math.min(active, Math.max(visible.length - 1, 0));
  const activeItem = visible[activeIndex];

  const groups: { label: string; items: PickerItem[] }[] = [];
  for (const item of visible) {
    const last = groups[groups.length - 1];
    if (last?.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }

  function goBack(): void {
    setLevel(null);
    setQuery("");
    setActive(0);
    input.current?.focus();
  }

  function drillInto(packId: string): void {
    setLevel(packId);
    setQuery("");
    setActive(0);
    input.current?.focus();
  }

  function activate(item: PickerItem | undefined): void {
    if (item === undefined || item.disabled) return;
    if (item.drill !== undefined) {
      drillInto(item.drill);
      return;
    }
    item.run();
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(visible.length === 0 ? 0 : (activeIndex + 1) % visible.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(visible.length === 0 ? 0 : (activeIndex - 1 + visible.length) % visible.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(visible.length - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(activeItem);
      return;
    }
    if (pack !== undefined && event.key === "Backspace" && query.length === 0) {
      event.preventDefault();
      goBack();
    }
  }

  const placeholder =
    pack === undefined
      ? "Search packs, Screens and documents"
      : `Search ${noun.plural.toLowerCase()}`;
  const empty = visible.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Escape closes at the root; inside a pack it steps back one level.
      onEscapeKeyDown={(event) => {
        if (pack === undefined) return;
        event.preventDefault();
        goBack();
      }}
      label="New tab"
      size="lg"
      header={
        <div className="flex items-center gap-2" data-testid={testId}>
          {pack === undefined ? null : (
            <button
              type="button"
              aria-label="Back to packs"
              onClick={goBack}
              className={cx(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
                MOTION,
                FOCUS_RING,
              )}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M10 3 5 8l5 5" />
              </svg>
            </button>
          )}
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label={placeholder}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeItem === undefined ? undefined : `${listId}-option-${activeIndex}`
            }
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className={cx(
              "h-9 min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-sunk)] px-2.5 text-[length:var(--text-body,13px)]",
              INK.base,
              FOCUS_RING,
            )}
          />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
              MOTION,
              FOCUS_RING,
            )}
          >
            <span aria-hidden="true">{"\u00d7"}</span>
          </button>
        </div>
      }
      footer={
        <p className="text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
          <span aria-hidden="true">{"\u2191\u2193"}</span> to move · Enter to open ·{" "}
          {pack === undefined ? "Esc to close" : "Backspace to go back"}
        </p>
      }
    >
      {/* The level change is the one thing a screen reader cannot infer from the list, which
          keeps its role. Polite, and it never repeats on each keystroke. */}
      <p aria-live="polite" className="sr-only">
        {pack === undefined
          ? ""
          : `${pack.name}, ${String(documents.length)} ${noun.plural.toLowerCase()}`}
      </p>
      {packs.length === 0 && needle.length === 0 ? (
        <p className="px-2 pb-2 text-[length:var(--text-body,13px)] text-[var(--ink-muted)]">
          No packs are installed yet. Install one to open its documents, or compose a Screen.
        </p>
      ) : null}
      <div id={listId} role="listbox" aria-label="Open a tab">
        <div className="flex flex-col gap-3" data-testid={`${testId}-list`}>
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <p
                aria-hidden="true"
                className="px-2 pb-1 text-[length:var(--text-caption,11px)] uppercase tracking-wide text-[var(--ink-faint)]"
              >
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const index = visible.indexOf(item);
                  const selected = index === activeIndex;
                  return (
                    <div
                      key={item.key}
                      id={`${listId}-option-${index}`}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={item.disabled ? true : undefined}
                      tabIndex={-1}
                      onClick={() => activate(item)}
                      onMouseMove={() => setActive(index)}
                      className={cx(
                        "flex items-center gap-3 rounded-md px-2 py-2",
                        selected && !item.disabled ? SURFACE.sunk : undefined,
                        item.disabled
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:bg-[var(--surface-sunk)]",
                        MOTION,
                      )}
                    >
                      {item.icon === undefined ? (
                        <span
                          aria-hidden="true"
                          className={cx(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            item.group === "Packs" || item.group === "Recents"
                              ? "bg-[var(--accent)]"
                              : "bg-[var(--ink-faint)]",
                          )}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md [&_img]:h-full [&_img]:w-full [&_img]:object-contain"
                        >
                          {item.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[length:var(--text-body,13px)] text-[var(--ink)]">
                          {item.label}
                        </span>
                        {item.description === undefined ? null : (
                          <span className="block truncate text-[length:var(--text-caption,11px)] text-[var(--ink-muted)]">
                            {item.description}
                          </span>
                        )}
                      </span>
                      {item.disabled ? (
                        <span className="shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
                          unavailable
                        </span>
                      ) : null}
                      {item.hint === undefined ? null : (
                        <span className="shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
                          {item.hint}
                        </span>
                      )}
                      {item.drill === undefined ? null : (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          className="h-3 w-3 shrink-0 text-[var(--ink-faint)]"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <path d="m6 3 5 5-5 5" />
                        </svg>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {empty ? (
        <p
          role="status"
          className="px-2 py-3 text-[length:var(--text-body,13px)] text-[var(--ink-muted)]"
        >
          {needle.length === 0 && pack !== undefined
            ? `No ${noun.plural.toLowerCase()} yet. Start a new ${noun.singular.toLowerCase()}.`
            : `Nothing matches “${query.trim()}”. Try a pack, a Screen or “Settings”.`}
        </p>
      ) : null}
    </Modal>
  );
}
