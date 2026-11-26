import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cx } from "../cx.js";
import { Modal } from "../Modal.js";
import { FOCUS_RING, INK, MOTION, SURFACE } from "../tokens.js";

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

interface PickerItem {
  readonly key: string;
  readonly group: "Packs" | "Screens" | "Host";
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly disabled: boolean;
  readonly run: () => void;
}

export function NewTabPicker({
  open,
  packs,
  screens,
  onClose,
  onOpenPack,
  onOpenScreen,
  onNewScreen,
  onOpenSettings,
  initialQuery = "",
  "data-testid": testId = "new-tab-picker",
}: NewTabPickerProps): ReactNode {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setActive(0);
    // Radix focuses the first control, which is the input; this keeps the intent explicit for
    // a caller that mounts the dialog already open.
    input.current?.focus();
  }, [open, initialQuery]);

  const items: PickerItem[] = [
    ...packs.map((pack) => ({
      key: `pack:${pack.id}`,
      group: "Packs" as const,
      label: pack.name,
      ...(pack.description === undefined ? {} : { description: pack.description }),
      ...(pack.icon === undefined ? {} : { icon: pack.icon }),
      disabled: pack.unavailable === true,
      run: () => onOpenPack(pack.id),
    })),
    ...screens.map((screen) => ({
      key: `screen:${screen.id}`,
      group: "Screens" as const,
      label: screen.name,
      ...(screen.description === undefined ? {} : { description: screen.description }),
      disabled: false,
      run: () => onOpenScreen(screen.id),
    })),
    {
      key: "action:new-screen",
      group: "Host" as const,
      label: "New screen",
      description: "Compose a new Screen",
      disabled: false,
      run: onNewScreen,
    },
    {
      key: "action:settings",
      group: "Host" as const,
      label: "Settings",
      description: "Appearance, packs, sync and backups",
      disabled: false,
      run: onOpenSettings,
    },
  ];

  const needle = query.trim().toLowerCase();
  const visible =
    needle.length === 0
      ? items
      : items.filter((item) =>
          `${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle),
        );
  const activeIndex = Math.min(active, Math.max(visible.length - 1, 0));
  const activeItem = visible[activeIndex];

  const groups: { label: string; items: PickerItem[] }[] = [];
  for (const item of visible) {
    const last = groups[groups.length - 1];
    if (last?.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }

  function activate(item: PickerItem | undefined) {
    if (item === undefined || item.disabled) return;
    item.run();
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
    if (event.key === "Enter") {
      event.preventDefault();
      activate(activeItem);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="New tab"
      size="lg"
      header={
        <div className="flex items-center gap-2" data-testid={testId}>
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Search apps, screens and commands"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeItem === undefined ? undefined : `${listId}-option-${activeIndex}`
            }
            autoComplete="off"
            spellCheck={false}
            placeholder="Search apps, screens and commands"
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
          <span aria-hidden="true">{"\u2191\u2193"}</span> to move · Enter to open · Esc to close
        </p>
      }
    >
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
                            item.group === "Packs"
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
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p
          role="status"
          className="px-2 py-3 text-[length:var(--text-body,13px)] text-[var(--ink-muted)]"
        >
          Nothing matches “{query.trim()}”. Try a pack, a screen or “Settings”.
        </p>
      ) : null}
    </Modal>
  );
}
