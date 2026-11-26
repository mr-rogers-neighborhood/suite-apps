import type { CreateBudgetInput, LibraryEntry, OpenBudgetInfo } from "@suite/budget-core";
import type { PackLaunchContext } from "@suite/pack-runtime";
import { Button } from "@suite/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "./app/Shell";
import { Toast } from "./app/Toast";
import { Modal } from "./components/Modal";
import { BudgetLauncher } from "./launcher/BudgetLauncher";
import { NewBudgetDialog } from "./launcher/NewBudgetDialog";
import { getBridge } from "./platform/bridge";
import { bootDocument, type DocumentReplica, WorkspaceContext } from "./store/snapshotStore";
import { useUiStore } from "./store/uiStore";

export function App() {
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [openInfo, setOpenInfo] = useState<OpenBudgetInfo | null>(null);
  const [replica, setReplica] = useState<DocumentReplica | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newBudgetOpen = useUiStore((state) => state.newBudgetOpen);

  const replicaRef = useRef<DocumentReplica | null>(null);
  const openRef = useRef<OpenBudgetInfo | null>(null);
  const bootHandled = useRef(false);

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await getBridge().listBudgets());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    openRef.current = openInfo;
  }, [openInfo]);

  useEffect(() => {
    replicaRef.current = replica;
  }, [replica]);

  useEffect(() => {
    if (!openInfo) {
      setReplica(null);
      return;
    }
    const next = bootDocument(openInfo.snapshot);
    setReplica(next);
    useUiStore.getState().resetForBudget();
    if (openInfo.warning) useUiStore.getState().setNotice(openInfo.warning, "error");
    return () => next.dispose();
  }, [openInfo]);

  useEffect(() => {
    if (!replica) return;
    // Main catches up on opening. This keeps checking while the app stays open so a
    // date that passes during the session still posts. Auto-entry is idempotent
    // because each posted occurrence advances nextDate inside the document.
    const run = (): void => {
      try {
        replica.document.autoEnterSchedules();
      } catch (cause) {
        console.error("Suite Budget: could not auto-enter schedules", cause);
      }
    };
    const timer = setInterval(run, 60_000);
    window.addEventListener("focus", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [replica]);

  const openBudget = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const info = await getBridge().openBudget(id);
        setOpenInfo(info);
        await refreshLibrary();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [refreshLibrary],
  );

  useEffect(() => {
    if (bootHandled.current) return;
    bootHandled.current = true;

    const launch = (
      globalThis as {
        __suiteBudgetLaunch?: Promise<PackLaunchContext>;
        suite?: { launch?(): Promise<PackLaunchContext> };
      }
    ).__suiteBudgetLaunch ?? (globalThis as { suite?: { launch?(): Promise<PackLaunchContext> } }).suite?.launch?.();

    if (launch === undefined) return;

    void launch
      .then(async (context) => {
        // The boot effect must run once and must not fight an already-open document.
        if (openRef.current !== null || replicaRef.current !== null) return;

        if (context.kind === "launcher") {
          return;
        }
        if (context.kind === "create") {
          useUiStore.getState().setNewBudgetOpen(true);
          return;
        }
        if (context.kind === "document" && typeof context.documentId === "string") {
          await openBudget(context.documentId);
          return;
        }
        if (context.kind !== "deep-link" && context.kind !== "file") {
          setError("This launch context is not supported.");
        }
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not open that budget.");
      });
  }, [openBudget]);

  const closeBudget = useCallback(async () => {
    try {
      await getBridge().closeBudget();
    } finally {
      setOpenInfo(null);
      await refreshLibrary();
    }
  }, [refreshLibrary]);

  const createBudget = useCallback(
    async (input: CreateBudgetInput) => {
      setBusy(true);
      try {
        const info = await getBridge().createBudget(input);
        useUiStore.getState().setNewBudgetOpen(false);
        setOpenInfo(info);
        await refreshLibrary();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [refreshLibrary],
  );

  const importBudget = useCallback(async () => {
    setBusy(true);
    try {
      const result = await getBridge().importBudget();
      if (result.opened) setOpenInfo(result.opened);
      await refreshLibrary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [refreshLibrary]);

  const removeBudget = useCallback(
    async (id: string) => {
      try {
        await getBridge().removeBudget(id);
        await refreshLibrary();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshLibrary],
  );

  const revealBudget = useCallback(async (id: string) => {
    await getBridge().revealBudget(id);
  }, []);

  const renameBudget = useCallback(
    async (id: string, name: string) => {
      await getBridge().renameBudget(id, name);
      await refreshLibrary();
    },
    [refreshLibrary],
  );

  const exportBudget = useCallback(async () => {
    if (!openRef.current) {
      useUiStore.getState().setNotice("Open a budget first");
      return;
    }
    const result = await getBridge().exportBudget();
    if (!result.canceled) {
      useUiStore.getState().setNotice(`Exported to ${result.path ?? "your chosen file"}`);
    }
  }, []);

  const exportRecords = useCallback(async (format: "json" | "csv" | "qif") => {
    if (!openRef.current) {
      useUiStore.getState().setNotice("Open a budget first");
      return;
    }
    const result = await getBridge().exportRecords(format);
    if (!result.canceled) {
      useUiStore
        .getState()
        .setNotice(`Exported ${format.toUpperCase()} to ${result.path ?? "file"}`);
    }
  }, []);

  useEffect(() => {
    const bridge = getBridge();
    const offOpened = bridge.onBudgetOpened((info) => {
      setOpenInfo(info);
      void refreshLibrary();
    });
    const offCommand = bridge.onCommand((command) => {
      const ui = useUiStore.getState();
      if (command === "new-budget") ui.setNewBudgetOpen(true);
      else if (command === "open-file") void importBudget();
      else if (command === "show-budgets") void closeBudget();
      else if (command === "export-budget" || command === "save-copy") void exportBudget();
      else if (command === "export-json") void exportRecords("json");
      else if (command === "export-csv") void exportRecords("csv");
      else if (command === "export-qif") void exportRecords("qif");
      else if (command === "close-budget") void closeBudget();
      else if (command === "undo") replicaRef.current?.undo();
      else if (command === "redo") replicaRef.current?.redo();
      else if (command === "view-plan") ui.setView("plan");
      else if (command === "view-accounts") ui.setView("accounts");
      else if (command === "view-reports") ui.setView("reports");
      else if (command === "new-transaction") {
        ui.setView("accounts");
        ui.setNewTransactionOpen(true);
      } else if (command === "command-palette") ui.setPaletteOpen(true);
    });
    return () => {
      offOpened();
      offCommand();
    };
  }, [closeBudget, exportBudget, exportRecords, importBudget, refreshLibrary]);

  return (
    <>
      {openInfo && replica ? (
        <WorkspaceContext.Provider value={replica}>
          <Shell
            onCloseBudget={() => void closeBudget()}
            onExportBudget={() => void exportBudget()}
            onExportRecords={(format) => void exportRecords(format)}
          />
        </WorkspaceContext.Provider>
      ) : (
        <BudgetLauncher
          entries={library}
          busy={busy}
          onOpen={(id) => void openBudget(id)}
          onImport={() => void importBudget()}
          onRemove={(id) => void removeBudget(id)}
          onReveal={(id) => void revealBudget(id)}
          onRename={(id, name) => void renameBudget(id, name)}
        />
      )}

      <NewBudgetDialog
        open={newBudgetOpen}
        busy={busy}
        onOpenChange={(open) => useUiStore.getState().setNewBudgetOpen(open)}
        onCreate={(input) => void createBudget(input)}
      />
      <Toast />
      <Modal
        open={error !== null}
        onOpenChange={(open) => {
          if (!open) setError(null);
        }}
        title="Something went wrong"
        footer={
          <Button variant="primary" onClick={() => setError(null)}>
            Close
          </Button>
        }
      >
        <p className="text-[13px] leading-relaxed text-muted">{error}</p>
      </Modal>
    </>
  );
}
