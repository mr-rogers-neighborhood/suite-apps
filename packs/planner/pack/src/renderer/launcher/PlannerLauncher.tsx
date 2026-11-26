import { Button, Launch, PrivacyLine } from "@suite/ui";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PlannerMark } from "../app/PlannerMark";
import { getBridge, type RecentDocumentRow } from "../platform/bridge";

/**
 * The screen a person lands on the first time, when there is no workspace file yet.
 *
 * Planner used to skip straight into an empty document, which answers a question nobody had
 * asked yet: the first thing a new user saw was a blank week with no way to tell whether their
 * work would be kept, or where.
 *
 * It appears only when the main process reports that it created the workspace this session, so
 * every later launch goes straight to the document. That check lives in the main process because
 * only it knows whether a file was read or invented.
 *
 * When the host declares `recents`, the other documents it has recorded show here as well. The
 * list is the host's metadata; opening one asks the host for that document by id, never a path.
 */
export function PlannerLauncher({
  onBegin,
  initialError,
}: {
  onBegin: () => void;
  initialError?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [recents, setRecents] = useState<readonly RecentDocumentRow[]>([]);

  useEffect(() => {
    if (initialError !== undefined) setError(initialError);
  }, [initialError]);

  useEffect(() => {
    const bridge = getBridge();
    const load = bridge.recentDocuments;
    if (load === undefined) return;
    let active = true;
    void load
      .call(bridge)
      .then((rows) => {
        if (active) setRecents(rows);
      })
      .catch(() => {
        // A refused or unavailable recent list is not a reason to hide the launcher.
      });
    return () => {
      active = false;
    };
  }, []);

  async function importWorkspace(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await getBridge().importWorkspace();
      if (!result.canceled) onBegin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import that file.");
    } finally {
      setBusy(false);
    }
  }

  async function openRecent(documentId: string): Promise<void> {
    const open = getBridge().openRecentDocument;
    if (open === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const opened = await open.call(getBridge(), documentId);
      if (opened) {
        onBegin();
        return;
      }
      setError("That planner is no longer in this app's documents.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that planner.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      aria-label="Planner start"
      className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8 sm:px-6 sm:py-10"
    >
      <Launch
        mark={<PlannerMark size="md" />}
        title="Suite Planner"
        tagline="A planner that lives in a file on this machine."
        hint="Start with an empty week, or open a planner file you already have."
        actions={
          <Button variant="primary" onClick={onBegin} disabled={busy}>
            <Plus size={14} />
            New planner
          </Button>
        }
        recents={recents.map((recent) => ({
          id: recent.documentId ?? "",
          name: recent.name ?? recent.documentId ?? "Planner",
          detail: `Opened ${new Date(recent.openedAt).toLocaleDateString()}`,
        }))}
        onOpenRecent={(id) => {
          if (id.length > 0) void openRecent(id);
        }}
        importOptions={[
          {
            label: "Planner file",
            detail: "A .planner file from anywhere",
            onSelect: () => void importWorkspace(),
          },
        ]}
        notice={
          error === null ? null : (
            <p
              role="alert"
              className="mb-3 rounded-lg bg-[var(--danger)] px-3 py-2 text-[12px] text-[var(--on-danger)]"
            >
              {error}
            </p>
          )
        }
        footer={<PrivacyLine />}
      />
    </main>
  );
}
