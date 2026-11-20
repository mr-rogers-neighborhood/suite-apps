import { focusFirstMenuItem, MenuBar, menuKeyDown, SyncPill } from "@suite/ui";
import { useEffect, useRef, useState } from "react";
import { syncPresentation } from "../feedback/syncState";
import { useEscapeLayer } from "../shell/escapeLayers";
import type { SyncInfo } from "../store/useCanvasStore";
import { ThemeToggle } from "../styles/ThemeToggle";
import { CanvasMark } from "./CanvasMark";

export type TitleBarRole = "editor" | "viewer";

export interface TitleBarProps {
  /**
   * What sync is doing and who is here, as the main process last said.
   *
   * The state belongs in the chrome rather than in the dialog, because being in a workspace
   * is continuous: a device waiting to be let in has to keep saying so after the dialog is
   * closed, or the flow looks silently dead.
   */
  sync: SyncInfo | null;
  /**
   * Present on a share link. It is not a sync state, so it reads inside the status
   * panel rather than in the chrome, which answers "is anyone else here".
   */
  role?: TitleBarRole;
  /** The relay's name for this workspace, shown inside the storage details. */
  workspaceId?: string;
  /** The workspace's own label; a share passes its scope label instead. */
  workspaceName?: string;
  canRenameWorkspace?: boolean;
  /** Returns a readable error, or null when the rename was accepted. */
  onRenameWorkspace?: (name: string) => string | null;
  /**
   * Other workspaces this browser has open lately, with the current one already
   * removed. Switching here rather than through the launcher is the point of
   * making the title a menu: boards and workspaces are the same question.
   */
  otherWorkspaces?: readonly { id: string; title: string }[];
  /** Leaves this workspace for another one; the leave guard decides if it asks. */
  onOpenWorkspace?: (id: string) => void;
  /**
   * Whether this workspace is pinned in this browser, and the one action that changes it.
   *
   * A workspace pin is the same gesture as a board pin with a smaller promise: it lifts
   * the workspace to the top of this list and the launcher, and it earns no tab, because
   * the tab strip belongs to the board you are on.
   */
  workspacePinned?: boolean;
  onToggleWorkspacePin?: ((workspaceId: string) => void) | undefined;
  /** Opens the sync dialog. The pill is the door, so the two cannot disagree. */
  onOpenSync?: (() => void) | undefined;
  /** Who else is in the workspace, drawn beside the pill. */
  peers?: React.ReactNode;
  /** Board switcher and saved views, rendered after the workspace name. */
  children?: React.ReactNode;
  /** Workspace-level actions (share, export), rendered before the theme. */
  actions?: React.ReactNode;
  /** Intercepts the brand link so the shell can animate before leaving. */
  onNavigateHome?: () => void;
  /**
   * The command bar's trigger. It fills whatever the tabs and the status group
   * leave free and opens the command palette, so the bar has one search surface
   * instead of a second, parallel one.
   */
  onOpenSearch?: (() => void) | undefined;
}

export function TitleBar({
  sync,
  role,
  workspaceId,
  workspaceName,
  canRenameWorkspace = false,
  onRenameWorkspace,
  otherWorkspaces = [],
  onOpenWorkspace,
  workspacePinned = false,
  onToggleWorkspacePin,
  children,
  actions,
  onNavigateHome,
  onOpenSync,
  peers,
  onOpenSearch,
}: TitleBarProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(workspaceName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  /** Where a right click on the name opened its menu, if it did. */
  const [nameMenuAt, setNameMenuAt] = useState<{ x: number; y: number } | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(() => setNameMenuOpen(false), nameMenuOpen && !renaming);
  useEscapeLayer(() => setNameMenuAt(null), nameMenuAt !== null);

  useEffect(() => {
    if (!nameMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!nameRef.current?.contains(event.target as Node)) setNameMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [nameMenuOpen]);

  // The button and the dialog read one decision, so they cannot disagree.
  const people = sync?.members.length ?? 0;
  const presentation = syncPresentation({ state: sync?.status ?? null, people });

  return (
    <MenuBar
      mark={<CanvasMark size="sm" />}
      onNavigateHome={onNavigateHome}
      context={
        workspaceName ? (
          <>
            {renaming ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: the label is an explicit rename gesture
                autoFocus
                value={draft}
                aria-label="Workspace name"
                data-testid="workspace-name-input"
                className="workspace-name-input"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onBlur={() => {
                  const problem = onRenameWorkspace?.(draft) ?? null;
                  if (problem) {
                    setError(problem);
                    return;
                  }
                  setRenaming(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setRenaming(false);
                    setDraft(workspaceName);
                    setError(null);
                  }
                }}
              />
            ) : (
              <div className="relative" ref={nameRef}>
                <button
                  type="button"
                  data-testid="workspace-name"
                  data-handbook-region="workspace-name"
                  aria-haspopup="menu"
                  aria-expanded={nameMenuOpen}
                  title={`${workspaceName} — switch workspace`}
                  className="workspace-name inline-flex max-w-[200px] items-center gap-1"
                  onClick={() => setNameMenuOpen((open) => !open)}
                  // The same menu the board name has: a right click is a shortcut to the
                  // two things worth doing to a workspace without leaving the page.
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setNameMenuOpen(false);
                    setNameMenuAt({ x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="min-w-0 truncate">{workspaceName}</span>
                  <span aria-hidden="true" className="shrink-0 opacity-60">
                    {"\u25be"}
                  </span>
                </button>
                {nameMenuOpen ? (
                  <div
                    role="menu"
                    aria-label="Workspace"
                    data-testid="workspace-switcher"
                    ref={focusFirstMenuItem}
                    onKeyDown={menuKeyDown}
                    className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 text-[12px] shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="workspace-switcher-rename"
                      disabled={!canRenameWorkspace}
                      className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                      onClick={() => {
                        setNameMenuOpen(false);
                        setDraft(workspaceName);
                        setError(null);
                        setRenaming(true);
                      }}
                    >
                      Rename workspace
                    </button>
                    {workspaceId && onToggleWorkspacePin ? (
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="workspace-switcher-pin"
                        className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => {
                          setNameMenuOpen(false);
                          onToggleWorkspacePin(workspaceId);
                        }}
                      >
                        {workspacePinned ? "Unpin workspace" : "Pin workspace to top"}
                      </button>
                    ) : null}
                    {otherWorkspaces.length > 0 && onOpenWorkspace ? (
                      <>
                        <hr className="my-1 border-[var(--hairline)]" />
                        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                          Workspaces
                        </p>
                        {otherWorkspaces.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            role="menuitem"
                            data-testid={`workspace-switcher-open-${entry.id}`}
                            className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={() => {
                              setNameMenuOpen(false);
                              onOpenWorkspace(entry.id);
                            }}
                          >
                            <span className="min-w-0 truncate">{entry.title}</span>
                          </button>
                        ))}
                      </>
                    ) : null}
                    <hr className="my-1 border-[var(--hairline)]" />
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="workspace-switcher-home"
                      className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => {
                        setNameMenuOpen(false);
                        onNavigateHome?.();
                      }}
                    >
                      Back to launcher
                    </button>
                  </div>
                ) : null}
                {nameMenuAt === null ? null : (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onPointerDown={() => setNameMenuAt(null)}
                      aria-hidden="true"
                    />
                    <div
                      role="menu"
                      aria-label="Workspace"
                      data-testid="workspace-name-menu"
                      ref={focusFirstMenuItem}
                      onKeyDown={menuKeyDown}
                      style={{ left: nameMenuAt.x, top: nameMenuAt.y }}
                      className="fixed z-50 w-48 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 text-[12px] shadow-xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="workspace-name-menu-rename"
                        disabled={!canRenameWorkspace}
                        className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                        onClick={() => {
                          setNameMenuAt(null);
                          setDraft(workspaceName);
                          setError(null);
                          setRenaming(true);
                        }}
                      >
                        Rename workspace
                      </button>
                      {workspaceId && onToggleWorkspacePin ? (
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="workspace-name-menu-pin"
                          className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => {
                            setNameMenuAt(null);
                            onToggleWorkspacePin(workspaceId);
                          }}
                        >
                          {workspacePinned ? "Unpin workspace" : "Pin workspace to top"}
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            )}
            {error ? (
              <span role="alert" className="workspace-name-error">
                {error}
              </span>
            ) : null}
          </>
        ) : null
      }
      navigation={
        children ? (
          <div className="ml-2 flex min-w-0 flex-initial items-center">{children}</div>
        ) : null
      }
      onOpenSearch={onOpenSearch}
      peers={peers}
      sync={
        <div className="relative" ref={statusRef}>
          <SyncPill
            situation={presentation.situation}
            label={presentation.label}
            peerCount={presentation.situation === "syncing" && people > 1 ? people : undefined}
            dotClassName={presentation.dot}
            role={role}
            onClick={onOpenSync}
          />
        </div>
      }
      actions={actions}
      controls={<ThemeToggle />}
    />
  );
}
