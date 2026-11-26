import type { PackLaunchContext } from "@suite/pack-runtime";
import { todayKey } from "@suite/planner-core";
import { useEffect, useRef, useState } from "react";
import { Shell } from "./app/Shell";
import { Toast } from "./app/Toast";
import { PlannerLauncher } from "./launcher/PlannerLauncher";
import { getBridge } from "./platform/bridge";
import { plannerDeepLinkView } from "../provider";
import { type DocumentReplica, WorkspaceContext } from "./store/snapshotStore";
import { useUiStore } from "./store/uiStore";

export function App({ replica, created }: { replica: DocumentReplica; created: boolean }) {
  const setNotice = useUiStore((state) => state.setNotice);
  const focusCapture = useUiStore((state) => state.focusCapture);
  const setView = useUiStore((state) => state.setView);
  const setSelectedDate = useUiStore((state) => state.setSelectedDate);
  // Only the run that invented the workspace starts here; dismissing is for this session only.
  const [begun, setBegun] = useState(!created);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const bootHandled = useRef(false);

  useEffect(() => {
    const bridge = getBridge();
    const offCommand = bridge.onCommand((command) => {
      if (command === "capture") focusCapture();
      if (command === "today") {
        setView("today");
        setSelectedDate(todayKey());
      }
      if (command === "inbox") setView("inbox");
    });
    const offReminder = bridge.onReminder((reminder) => {
      setNotice(`Reminder · ${reminder.title}`);
    });

    // A reminder click opens the host, which routes `suite://planner/task/<id>`.
    // A Command Surface scope opens `suite://planner/today` or `/inbox`. Resolving
    // it belongs here, once the pack is running with its document.
    const resolveDeepLink = (url: string): void => {
      const view = plannerDeepLinkView(url);
      if (view === "today") {
        setView("today");
        setSelectedDate(todayKey());
        return;
      }
      if (view === "inbox") {
        setView("inbox");
        return;
      }
      const match = /^suite:\/\/planner\/task\/(.+)$/u.exec(url);
      if (match === null) return;
      try {
        setView("inbox");
        useUiStore.getState().selectTask(decodeURIComponent(match[1] ?? ""));
      } catch {
        // A malformed id is the host's refusal to show, not a second route.
      }
    };

    const launch = (
      globalThis as {
        __suitePlannerLaunch?: Promise<PackLaunchContext>;
        suite?: { launch?(): Promise<PackLaunchContext> };
      }
    ).__suitePlannerLaunch ?? (globalThis as { suite?: { launch?(): Promise<PackLaunchContext> } }).suite?.launch?.();
    if (launch !== undefined) {
      void launch
        .then(async (context) => {
          if (bootHandled.current) return;
          bootHandled.current = true;

          if (context.kind === "deep-link" && typeof context.url === "string") {
            resolveDeepLink(context.url);
          } else if (context.kind === "create") {
            setBegun(true);
          } else if (context.kind === "document" && typeof context.documentId === "string") {
            const bridge = getBridge();
            const open = bridge.openRecentDocument;
            if (open === undefined) {
              setBegun(false);
              setLaunchError("This host cannot open documents by id.");
              return;
            }
            try {
              const opened = await open.call(bridge, context.documentId);
              if (opened) {
                setBegun(true);
              } else {
                setBegun(false);
                setLaunchError("That planner is no longer in this app's documents.");
              }
            } catch (cause) {
              setBegun(false);
              setLaunchError(cause instanceof Error ? cause.message : "Could not open that planner.");
            }
          } else if (context.kind !== "launcher" && context.kind !== "file") {
            setBegun(false);
            setLaunchError("This launch context is not supported.");
          }
        })
        .catch((cause) => {
          setBegun(false);
          setLaunchError(cause instanceof Error ? cause.message : "Could not open that planner.");
        });
    }
    const offDeepLink = bridge.onDeepLink?.(resolveDeepLink);

    return () => {
      offCommand();
      offReminder();
      offDeepLink?.();
    };
  }, [focusCapture, setNotice, setSelectedDate, setView]);

  return (
    <WorkspaceContext.Provider value={replica}>
      {begun ? <Shell /> : <PlannerLauncher onBegin={() => setBegun(true)} initialError={launchError} />}
      <Toast />
    </WorkspaceContext.Provider>
  );
}
