"use client";

import { GitBranch, Menu, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DetailPane } from "@/components/explorer/detail";
import { ExplorerSidebar } from "@/components/explorer/sidebar";
import type {
  BaseData,
  ModuleData,
  ModuleSummary,
  SearchEntry,
  View,
  Walk,
} from "@/lib/explorer-types";

type UrlState = {
  view?: View;
  node?: string;
  module?: string;
  walk?: string;
  step?: number;
};

function readUrl(): UrlState {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const step = Number(params.get("step"));
  return {
    view: view === "browser" || view === "modules" || view === "walkthroughs" ? view : undefined,
    node: params.get("node") ?? undefined,
    module: params.get("module") ?? undefined,
    walk: params.get("walk") ?? undefined,
    step: Number.isFinite(step) ? step : undefined,
  };
}

const START_EXPANDED = new Set(["", "apps", "packages", "tools"]);

export function Explorer() {
  const [data, setData] = useState<BaseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("walkthroughs");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [walkId, setWalkId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(START_EXPANDED);
  const [internalOpen, setInternalOpen] = useState<Set<string>>(new Set());
  const [modules, setModules] = useState<Record<string, ModuleData>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const requestedModules = useRef(new Set<string>());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/data/tree.json").then((response) => response.json()),
      fetch("/data/modules.json").then((response) => response.json()),
      fetch("/data/search.json").then((response) => response.json()),
      fetch("/data/walks.json").then((response) => response.json()),
    ])
      .then(([tree, modules, search, walks]) => {
        if (!cancelled) setData({ tree, modules, search, walks });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const state = readUrl();
    if (state.view) setView(state.view);
    if (state.node) setSelectedNode(state.node);
    if (state.module) setSelectedModule(state.module);
    if (state.walk) setWalkId(state.walk);
    if (state.step !== undefined) setStepIndex(state.step);
    setHydrated(true);
  }, []);

  const searchById = useMemo(
    () => new Map((data?.search ?? []).map((entry) => [entry.id, entry])),
    [data],
  );
  const moduleById = useMemo(
    () => new Map((data?.modules ?? []).map((module) => [module.id, module])),
    [data],
  );

  const walk = useMemo(
    () => data?.walks.find((candidate) => candidate.id === walkId) ?? null,
    [data, walkId],
  );

  useEffect(() => {
    if (!data || walkId) return;
    const start = data.walks.find((candidate) => candidate.start) ?? data.walks[0];
    if (start) setWalkId(start.id);
  }, [data, walkId]);

  const step = walk?.steps[stepIndex];
  const currentNodeId = view === "walkthroughs" ? (step?.node ?? null) : selectedNode;
  const currentEntry = currentNodeId ? searchById.get(currentNodeId) : undefined;
  const activeModuleId = view === "modules" ? selectedModule : (currentEntry?.moduleId ?? null);

  useEffect(() => {
    if (!activeModuleId) return;
    if (modules[activeModuleId] || requestedModules.current.has(activeModuleId)) return;
    const summary = moduleById.get(activeModuleId);
    if (!summary) return;
    requestedModules.current.add(activeModuleId);
    fetch(`/data/modules/${summary.slug}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`module ${activeModuleId} is missing`);
        return response.json();
      })
      .then((module: ModuleData) => {
        setModules((previous) => ({ ...previous, [activeModuleId]: module }));
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [activeModuleId, moduleById, modules]);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    params.set("view", view);
    if (view === "browser" && selectedNode) params.set("node", selectedNode);
    if (view === "modules" && selectedModule) params.set("module", selectedModule);
    if (view === "walkthroughs" && walkId) {
      params.set("walk", walkId);
      params.set("step", String(stepIndex));
    }
    const queryString = params.toString();
    window.history.replaceState(null, "", `/explore${queryString ? `?${queryString}` : ""}`);
  }, [hydrated, view, selectedNode, selectedModule, walkId, stepIndex]);

  const expandFor = useCallback(
    (id: string) => {
      const entry = searchById.get(id);
      const path = (entry?.path ?? id).split("#")[0];
      const parts = path.split("/");
      setExpanded((previous) => {
        const next = new Set(previous);
        for (let index = 1; index < parts.length; index += 1) {
          next.add(parts.slice(0, index).join("/"));
        }
        return next;
      });
    },
    [searchById],
  );

  const selectNode = useCallback(
    (id: string, nextView?: View) => {
      setSelectedNode(id);
      expandFor(id);
      setView(nextView ?? (view === "walkthroughs" ? "browser" : view));
      setSidebarOpen(false);
    },
    [expandFor, view],
  );

  const selectModule = useCallback((id: string) => {
    setSelectedModule(id);
    setSelectedNode(null);
    setView("modules");
    setSidebarOpen(false);
  }, []);

  const selectWalk = useCallback((id: string) => {
    setWalkId(id);
    setStepIndex(0);
    setSelectedNode(null);
    setView("walkthroughs");
    setSidebarOpen(false);
  }, []);

  const selectStep = useCallback(
    (index: number) => {
      if (!walk) return;
      const next = Math.max(0, Math.min(walk.steps.length - 1, index));
      setStepIndex(next);
      setSelectedNode(null);
      setView("walkthroughs");
      setSidebarOpen(false);
    },
    [walk],
  );

  const changeView = useCallback(
    (nextView: View) => {
      if (nextView === "browser" && view === "walkthroughs" && step) {
        setSelectedNode(step.node);
        expandFor(step.node);
      }
      if (nextView === "modules" && currentEntry?.moduleId) {
        setSelectedModule(currentEntry.moduleId);
      }
      if (nextView === "walkthroughs" && selectedNode && walk) {
        const index = walk.steps.findIndex((candidate) => candidate.node === selectedNode);
        if (index >= 0) setStepIndex(index);
      }
      setView(nextView);
    },
    [currentEntry?.moduleId, expandFor, selectedNode, step, view, walk],
  );

  const selectSearch = useCallback(
    (entry: SearchEntry) => {
      setQuery("");
      if (entry.kind === "module") {
        selectModule(entry.id);
        return;
      }
      if (entry.kind === "walk") {
        selectWalk(entry.id.replace(/^walk:/, ""));
        return;
      }
      setSelectedNode(entry.id);
      expandFor(entry.id);
      setView("browser");
      setSidebarOpen(false);
    },
    [expandFor, selectModule, selectWalk],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (view !== "walkthroughs" || !walk) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "j") {
        event.preventDefault();
        selectStep(stepIndex + 1);
      }
      if (event.key === "ArrowLeft" || event.key === "k") {
        event.preventDefault();
        selectStep(stepIndex - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectStep, stepIndex, view, walk]);

  const toggle = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleInternal = useCallback((fileId: string) => {
    setInternalOpen((previous) => {
      const next = new Set(previous);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  return (
    <div className="min-h-dvh bg-fd-background text-fd-foreground">
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 border-b border-fd-border bg-fd-background/95 px-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          className="rounded-lg p-1.5 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground md:hidden"
          aria-label="Toggle navigator"
        >
          {sidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
        <Link href="/" className="font-semibold tracking-tight">
          Suite docs
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-xs text-fd-muted-foreground">
          <Link
            href="/start"
            className="rounded-lg px-2 py-1.5 hover:bg-fd-accent hover:text-fd-foreground"
          >
            Start
          </Link>
          <Link
            href="/docs"
            className="rounded-lg px-2 py-1.5 hover:bg-fd-accent hover:text-fd-foreground"
          >
            Reference
          </Link>
          <Link
            href="/explore?view=walkthroughs"
            className="rounded-lg bg-fd-accent px-2 py-1.5 font-medium text-fd-accent-foreground"
          >
            Walkthroughs
          </Link>
          <a
            href="https://github.com/mr-rogers-neighborhood/suite-apps"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-1.5 hover:bg-fd-accent hover:text-fd-foreground"
            aria-label="GitHub"
          >
            <GitBranch className="size-4" />
          </a>
        </nav>
      </header>

      <div className="pt-14">
        {error ? (
          <div className="p-8 text-sm text-red-500">
            The index could not be loaded: {error}. Run <code>pnpm docs:index</code>.
          </div>
        ) : !data ? (
          <div className="grid h-[calc(100dvh-3.5rem)] place-items-center text-sm text-fd-muted-foreground">
            Loading the code index…
          </div>
        ) : (
          <div className="grid h-[calc(100dvh-3.5rem)] md:grid-cols-[20rem_minmax(0,1fr)]">
            {sidebarOpen ? (
              <button
                type="button"
                aria-label="Close navigator"
                onClick={() => setSidebarOpen(false)}
                className="fixed inset-0 z-30 bg-black/40 md:hidden"
              />
            ) : null}
            <aside
              className={
                sidebarOpen
                  ? "fixed inset-y-14 left-0 z-40 w-[20rem] border-r border-fd-border bg-fd-background shadow-xl md:static md:z-auto md:shadow-none"
                  : "hidden min-h-0 border-r border-fd-border md:block"
              }
            >
              <ExplorerSidebar
                view={view}
                onChangeView={changeView}
                query={query}
                onChangeQuery={setQuery}
                search={data.search}
                searchById={searchById}
                moduleById={moduleById}
                modules={data.modules}
                tree={data.tree}
                walks={data.walks}
                selectedNode={currentNodeId}
                selectedModule={selectedModule}
                walkId={walkId}
                stepIndex={stepIndex}
                expanded={expanded}
                internalOpen={internalOpen}
                onSelectNode={selectNode}
                onSelectModule={selectModule}
                onToggle={toggle}
                onToggleInternal={toggleInternal}
                onSelectWalk={selectWalk}
                onSelectStep={selectStep}
                onSearchSelect={selectSearch}
              />
            </aside>

            <main className="flex min-h-0 min-w-0 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <DetailPane
                  view={view}
                  currentNodeId={currentNodeId}
                  selectedModule={selectedModule}
                  walk={walk}
                  stepIndex={stepIndex}
                  moduleData={modules}
                  searchById={searchById}
                  moduleById={moduleById}
                  onSelectNode={selectNode}
                  onSelectModule={selectModule}
                  onOpenBrowser={(id) => selectNode(id, "browser")}
                  onSelectWalkStep={selectStep}
                />
              </div>
              <StatusBar
                view={view}
                entry={currentEntry}
                module={activeModuleId ? moduleById.get(activeModuleId) : undefined}
                walk={walk}
                stepIndex={stepIndex}
                onPrev={() => selectStep(stepIndex - 1)}
                onNext={() => selectStep(stepIndex + 1)}
              />
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBar({
  view,
  entry,
  module,
  walk,
  stepIndex,
  onPrev,
  onNext,
}: {
  view: View;
  entry?: SearchEntry;
  module?: ModuleSummary;
  walk: Walk | null;
  stepIndex: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-fd-border px-3 text-[11px] text-fd-muted-foreground">
      <span className="uppercase tracking-wide">{view}</span>
      {entry ? (
        <>
          <span className="text-fd-border">/</span>
          <span className="truncate">{entry.label}</span>
          {module ? (
            <span className="truncate text-fd-muted-foreground">· {module.title}</span>
          ) : null}
        </>
      ) : module ? (
        <span className="truncate">{module.title}</span>
      ) : null}
      {view === "walkthroughs" && walk ? (
        <div className="ml-auto flex items-center gap-2">
          <span>
            {stepIndex + 1} / {walk.steps.length}
          </span>
          <button
            type="button"
            onClick={onPrev}
            disabled={stepIndex === 0}
            className="rounded border border-fd-border px-2 py-0.5 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={stepIndex >= walk.steps.length - 1}
            className="rounded border border-fd-border px-2 py-0.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : (
        <span className="ml-auto">generated from the code index</span>
      )}
    </footer>
  );
}
