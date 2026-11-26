import { AppShell } from "@suite/ui";
import { GitBranch, Menu, X } from "lucide-react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { DetailPane } from "@/explorer/detail";
import { Note } from "@/explorer/note";
import { ExplorerSidebar } from "@/explorer/sidebar";
import { loadBaseData } from "@/lib/explorer-data";
import { docsPageUrl, readExplorerUrl } from "@/lib/explorer-routes";
import type {
  BaseData,
  FolderNode,
  ModuleData,
  ModuleSummary,
  SearchEntry,
  Tour,
  TourStep,
  TourTarget,
  View,
} from "@/lib/explorer-types";
import { SectionSwitch } from "@/sections";

function targetNodeId(target: TourTarget): string | null {
  if (
    target.kind === "node" ||
    target.kind === "module" ||
    target.kind === "file" ||
    target.kind === "symbol"
  ) {
    return target.id;
  }
  return null;
}

function stepLevel(step: TourStep | undefined): "file" | "symbol" | null {
  if (step?.kind !== "node") return null;
  if (step.target.kind !== "symbol") return null;
  return step.target.level === "file" ? "file" : "symbol";
}

const START_EXPANDED = new Set(["", "hosts", "legacy", "packs", "services", "packages", "tools"]);
const SIDEBAR_KEY = "suite.docs.sidebarWidth";
const SIDEBAR_DEFAULT = 320;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_COMPACT = 260;

function clampWidth(width: number) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
}

/**
 * Whether the window is wide enough for the navigator column.
 *
 * The shared `AppShell` stacks its navigation above the content below `md`; the explorer
 * needs a drawer instead, because a stacked rail would take half a phone screen and push
 * the document off it. jsdom has no `matchMedia`, and a missing query is the desktop
 * arrangement, which is the shape the existing tests describe.
 */
function useWideViewport(): boolean {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia(query).matches : true,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return wide;
}

export function Explorer() {
  const [data, setData] = useState<BaseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("tours");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [tourId, setTourId] = useState<string | null>(null);
  const [tourIndex, setTourIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(START_EXPANDED);
  const [internalOpen, setInternalOpen] = useState<Set<string>>(new Set());
  const [modules, setModules] = useState<Record<string, ModuleData>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarReady, setSidebarReady] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [detailLevel, setDetailLevel] = useState<"file" | "symbol" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const requestedModules = useRef(new Set<string>());
  const [hydrated, setHydrated] = useState(false);
  const wide = useWideViewport();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    loadBaseData((url) => fetch(url))
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Router state, not `window.location`: the pack mounts this app under `HashRouter`, where the
    // query lives in the hash and `window.location.search` is empty.
    const state = readExplorerUrl(location.search);
    if (state.view) setView(state.view);
    if (state.node) setSelectedNode(state.node);
    if (state.module) setSelectedModule(state.module);
    if (state.tour) {
      setTourId(state.tour);
      setTourIndex(state.step ?? -1);
    } else if (state.step !== undefined) {
      setTourIndex(state.step);
    }
    if (state.level) setDetailLevel(state.level);
    setHydrated(true);
  }, [location.search]);

  useEffect(() => {
    if (!sidebarOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SIDEBAR_KEY));
    if (Number.isFinite(stored) && stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX) {
      setSidebarWidth(stored);
    }
    setSidebarReady(true);
  }, []);

  useEffect(() => {
    if (!sidebarReady) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [sidebarReady, sidebarWidth]);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      setResizing(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      const move = (moveEvent: PointerEvent) => {
        setSidebarWidth(clampWidth(startWidth + moveEvent.clientX - startX));
      };
      const stop = () => {
        setResizing(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
    [sidebarWidth],
  );

  const resizeKey = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setSidebarWidth((width) => clampWidth(width - step));
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      setSidebarWidth((width) => clampWidth(width + step));
    }
    if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      setSidebarWidth(SIDEBAR_MIN);
    }
    if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      setSidebarWidth(SIDEBAR_MAX);
    }
  }, []);

  const searchById = useMemo(
    () => new Map((data?.search ?? []).map((entry) => [entry.id, entry])),
    [data],
  );
  const tourNodes = useMemo(() => new Set(Object.keys(data?.membership ?? {})), [data?.membership]);
  const moduleById = useMemo(
    () => new Map((data?.modules ?? []).map((module) => [module.id, module])),
    [data],
  );

  const tour = useMemo(
    () => data?.tours.find((candidate) => candidate.id === tourId) ?? null,
    [data, tourId],
  );
  const currentStep = tour && tourIndex >= 0 ? tour.steps[tourIndex] : undefined;

  useEffect(() => {
    if (!data || tourId) return;
    const start = data.tours.find((candidate) => candidate.start) ?? data.tours[0];
    if (start) {
      setTourId(start.id);
      setTourIndex(-1);
    }
  }, [data, tourId]);

  const currentNodeId =
    view === "tours"
      ? currentStep?.kind === "node"
        ? targetNodeId(currentStep.target)
        : null
      : selectedNode;
  const currentEntry = currentNodeId ? searchById.get(currentNodeId) : undefined;
  const activeModuleId =
    view === "modules"
      ? selectedModule
      : view === "tours" && currentStep?.kind === "node" && currentStep.target.kind === "module"
        ? currentStep.target.id
        : (currentEntry?.moduleId ?? null);

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
    if (view === "tours" && tourId) {
      params.set("tour", tourId);
      if (tourIndex >= 0) params.set("step", String(tourIndex));
    }
    const level = view === "tours" ? stepLevel(currentStep) : detailLevel;
    if (level === "file") params.set("level", "file");
    const queryString = params.toString();
    // Route through the router, not `window.history`: `HashRouter` owns the hash and a raw
    // replaceState would leave the route it is rendering out of step with the address bar.
    navigate(`/explore${queryString ? `?${queryString}` : ""}`, { replace: true });
  }, [
    currentStep,
    detailLevel,
    hydrated,
    navigate,
    selectedModule,
    selectedNode,
    tourId,
    tourIndex,
    view,
  ]);

  const expandFor = useCallback(
    (id: string) => {
      const entry = searchById.get(id);
      const [filePath] = (entry?.path ?? id).split("#");
      const path = filePath ?? id;
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

  useEffect(() => {
    if (currentNodeId) expandFor(currentNodeId);
  }, [currentNodeId, expandFor]);

  const selectNode = useCallback(
    (id: string, nextView?: View) => {
      setSelectedNode(id);
      setDetailLevel(null);
      expandFor(id);
      setView(nextView ?? (view === "tours" ? "browser" : view));
      setSidebarOpen(false);
    },
    [expandFor, view],
  );

  const selectModule = useCallback((id: string) => {
    setSelectedModule(id);
    setSelectedNode(null);
    setDetailLevel(null);
    setView("modules");
    setSidebarOpen(false);
  }, []);

  const goToTourStep = useCallback(
    (index: number, options?: { auto?: boolean }) => {
      if (!tour) return;
      const next = Math.max(-1, Math.min(tour.steps.length - 1, index));
      const step = next >= 0 ? tour.steps[next] : undefined;
      if (step?.kind === "node" && step.target.kind === "tour") {
        setTourId(step.target.id);
        setTourIndex(step.target.step ?? 0);
        setSelectedNode(null);
        setDetailLevel(null);
        setOverlayDismissed(false);
        setPlaying(false);
        setView("tours");
        setSidebarOpen(false);
        return;
      }
      if (step?.kind === "node" && step.target.kind === "doc") {
        setPlaying(false);
        const href = docsPageUrl(data?.docs ?? [], step.target.path);
        if (href !== undefined) navigate(href);
        return;
      }
      setTourIndex(next);
      setOverlayDismissed(false);
      if (!options?.auto) setPlaying(false);
      setSelectedNode(null);
      setDetailLevel(stepLevel(step));
      setView("tours");
      setSidebarOpen(false);
    },
    [navigate, tour, data],
  );

  const selectTour = useCallback((id: string) => {
    setTourId(id);
    setTourIndex(-1);
    setSelectedNode(null);
    setDetailLevel(null);
    setOverlayDismissed(false);
    setPlaying(false);
    setView("tours");
    setSidebarOpen(false);
  }, []);

  const changeView = useCallback(
    (nextView: View) => {
      setPlaying(false);
      if (nextView === "browser" && view === "tours" && currentStep?.kind === "node") {
        const id = targetNodeId(currentStep.target);
        if (id) {
          setSelectedNode(id);
          expandFor(id);
        }
      }
      if (nextView === "modules" && view === "tours" && currentStep?.kind === "node") {
        if (currentStep.target.kind === "module") setSelectedModule(currentStep.target.id);
        else if (currentEntry?.moduleId) setSelectedModule(currentEntry.moduleId);
      }
      if (nextView === "tours" && view === "browser" && selectedNode && data) {
        for (const candidate of data.tours) {
          const index = candidate.steps.findIndex(
            (step) => step.kind === "node" && targetNodeId(step.target) === selectedNode,
          );
          if (index >= 0) {
            setTourId(candidate.id);
            setTourIndex(index);
            break;
          }
        }
      }
      if (nextView === "tours" && view === "modules" && selectedModule && data) {
        for (const candidate of data.tours) {
          const index = candidate.steps.findIndex(
            (step) =>
              step.kind === "node" &&
              step.target.kind === "module" &&
              step.target.id === selectedModule,
          );
          if (index >= 0) {
            setTourId(candidate.id);
            setTourIndex(index);
            break;
          }
        }
      }
      setView(nextView);
    },
    [currentEntry?.moduleId, currentStep, data, expandFor, selectedModule, selectedNode, view],
  );

  const selectSearch = useCallback(
    (entry: SearchEntry) => {
      setQuery("");
      if (entry.kind === "module") {
        selectModule(entry.id);
        return;
      }
      if (entry.kind === "tour") {
        selectTour(entry.id.replace(/^tour:/, ""));
        return;
      }
      setSelectedNode(entry.id);
      setDetailLevel(null);
      expandFor(entry.id);
      setView("browser");
      setSidebarOpen(false);
    },
    [expandFor, selectModule, selectTour],
  );

  const zoomOut = useCallback(() => {
    if (!currentNodeId) return;
    const entry = searchById.get(currentNodeId);
    if (!entry) return;
    if (entry.id.includes("#")) {
      const file = searchById.get(entry.path);
      if (file?.kind === "file") selectNode(file.id, "browser");
      return;
    }
    if (entry.kind === "file" && entry.moduleId) selectModule(entry.moduleId);
  }, [currentNodeId, searchById, selectModule, selectNode]);

  const zoomIn = useCallback(() => {
    if (view === "modules" && selectedModule) {
      const files = modules[selectedModule]?.files ?? [];
      const file = files.find((candidate) => candidate.symbols.some((symbol) => symbol.exported));
      if (file) selectNode(file.id, "browser");
      return;
    }
    if (!currentNodeId) return;
    const entry = searchById.get(currentNodeId);
    if (!entry || entry.id.includes("#")) return;
    const file = modules[entry.moduleId ?? ""]?.files.find(
      (candidate) => candidate.id === entry.path,
    );
    const symbol = file?.symbols.find((candidate) => candidate.exported);
    if (symbol) selectNode(symbol.id, "browser");
  }, [currentNodeId, modules, searchById, selectNode, selectedModule, view]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowUp") {
        event.preventDefault();
        zoomOut();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowDown") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === "Escape") {
        if (overlayDismissed === false && currentStep?.overlay) {
          setOverlayDismissed(true);
          return;
        }
        if (playing) setPlaying(false);
        return;
      }
      if (view !== "tours" || !tour) return;
      if (event.key === "ArrowRight" || event.key === "j") {
        event.preventDefault();
        goToTourStep(tourIndex + 1);
      }
      if (event.key === "ArrowLeft" || event.key === "k") {
        event.preventDefault();
        goToTourStep(tourIndex - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    currentStep?.overlay,
    goToTourStep,
    overlayDismissed,
    playing,
    tour,
    tourIndex,
    view,
    zoomIn,
    zoomOut,
  ]);

  useEffect(() => {
    if (!playing || view !== "tours" || !tour || tourIndex < 0) return;
    const step = tour.steps[tourIndex];
    if (!step || step.kind === "interlude" || (step.overlay && !overlayDismissed)) {
      setPlaying(false);
      return;
    }
    if (tourIndex >= tour.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => goToTourStep(tourIndex + 1, { auto: true }), 6000);
    return () => window.clearTimeout(timer);
  }, [goToTourStep, overlayDismissed, playing, tour, tourIndex, view]);

  const overlayVisible = Boolean(currentStep?.overlay) && !overlayDismissed;
  const canPlay =
    view === "tours" &&
    tour !== null &&
    currentStep?.kind === "node" &&
    !overlayVisible &&
    tourIndex >= 0 &&
    tourIndex < tour.steps.length - 1;

  const navigator = (compact: boolean) => (
    <>
      <ExplorerSidebar
        view={view}
        onChangeView={changeView}
        query={query}
        onChangeQuery={setQuery}
        search={data?.search ?? []}
        searchById={searchById}
        moduleById={moduleById}
        modules={data?.modules ?? []}
        tree={data?.tree ?? emptyTree}
        tours={data?.tours ?? []}
        tourNodes={tourNodes}
        selectedNode={currentNodeId}
        selectedModule={selectedModule}
        tourId={tourId}
        tourIndex={tourIndex}
        expanded={expanded}
        internalOpen={internalOpen}
        compact={compact}
        onSelectNode={selectNode}
        onSelectModule={selectModule}
        onToggle={toggle}
        onToggleInternal={toggleInternal}
        onSelectTour={selectTour}
        onSelectTourStep={goToTourStep}
        onSearchSelect={selectSearch}
      />
      {wide ? (
        <hr
          aria-orientation="vertical"
          aria-label="Resize navigator"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={beginResize}
          onKeyDown={resizeKey}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
          className="absolute right-0 top-0 z-10 m-0 hidden h-full w-1.5 cursor-col-resize border-0 bg-transparent transition-colors hover:bg-fd-primary/40 focus:bg-fd-primary/40 focus:outline-none md:block"
        />
      ) : null}
    </>
  );

  return (
    <>
      <a
        href="#explorer-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-fd-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <AppShell
        title="Suite Help"
        navigationLabel="Code navigator"
        leading={
          wide ? undefined : (
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              className="rounded-lg p-1.5 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
              aria-label="Toggle navigator"
              aria-controls="explorer-sidebar"
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          )
        }
        actions={
          <nav
            aria-label="Help sections"
            className="flex items-center gap-1 text-xs text-fd-muted-foreground"
          >
            <Link
              to="/handbook"
              className="rounded-lg px-2 py-1.5 hover:bg-fd-accent hover:text-fd-foreground"
            >
              Handbook
            </Link>
            <Link
              to="/explore?view=tours"
              className="hidden rounded-lg bg-fd-accent px-2 py-1.5 font-medium text-fd-accent-foreground sm:inline-flex"
            >
              Tours
            </Link>
            <SectionSwitch audience="developer" />
            <a
              href="https://github.com/mrrnbhd/suite-apps"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg p-1.5 hover:bg-fd-accent sm:inline-flex"
              aria-label="GitHub"
            >
              <GitBranch className="size-4" />
            </a>
          </nav>
        }
        navigation={wide ? <div className="relative h-full">{navigator(sidebarWidth < SIDEBAR_COMPACT)}</div> : undefined}
        style={wide ? ({ "--shell-nav-width": `${sidebarWidth}px` } as CSSProperties) : undefined}
        className="h-dvh"
      >
        <div id="explorer-main" className="relative flex h-full min-h-0 flex-col">
          {error ? (
            <div className="p-4 text-sm text-red-500 sm:p-8">
              The index could not be loaded: {error}. Run <code>pnpm docs:index</code>.
            </div>
          ) : !data ? (
            <div className="grid h-full place-items-center text-sm text-fd-muted-foreground">
              Loading the code index…
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1">
                <DetailPane
                  view={view}
                  currentNodeId={currentNodeId}
                  selectedModule={selectedModule}
                  tour={tour}
                  tourIndex={tourIndex}
                  detailLevel={view === "tours" ? stepLevel(currentStep) : detailLevel}
                  moduleData={modules}
                  searchById={searchById}
                  moduleById={moduleById}
                  membership={data.membership}
                  onSelectNode={selectNode}
                  onSelectModule={selectModule}
                  onOpenBrowser={(id) => selectNode(id, "browser")}
                  onSelectTourStep={goToTourStep}
                  onStartTour={() => goToTourStep(0)}
                  onOpenTour={(id, step) => {
                    setTourId(id);
                    setTourIndex(step);
                    setView("tours");
                    setOverlayDismissed(false);
                    setPlaying(false);
                  }}
                />
              </div>
              {overlayVisible && currentStep?.overlay ? (
                <OverlayCard
                  overlay={currentStep.overlay}
                  onClose={() => setOverlayDismissed(true)}
                />
              ) : null}
              <StatusBar
                view={view}
                entry={currentEntry}
                module={activeModuleId ? moduleById.get(activeModuleId) : undefined}
                tour={tour}
                tourIndex={tourIndex}
                playing={playing}
                canPlay={canPlay}
                onPrev={() => goToTourStep(tourIndex - 1)}
                onNext={() => goToTourStep(tourIndex + 1)}
                onTogglePlay={() => setPlaying((value) => !value)}
              />
            </>
          )}
        </div>
      </AppShell>

      {!wide && sidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Dismiss navigator"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside
            id="explorer-sidebar"
            aria-label="Code navigator"
            data-resizing={resizing}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-fd-border bg-fd-background shadow-xl"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-fd-border px-3">
              <span className="text-sm font-semibold">Navigator</span>
              <button
                type="button"
                aria-label="Close navigator"
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{navigator(false)}</div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

const emptyTree: FolderNode = { type: "folder", name: "", path: "", children: [] };

function OverlayCard({
  overlay,
  onClose,
}: {
  overlay: NonNullable<TourStep["overlay"]>;
  onClose: () => void;
}) {
  return (
    <aside
      role="status"
      aria-live="polite"
      className={`absolute bottom-12 left-3 right-3 z-20 max-h-[45%] overflow-y-auto rounded-xl border p-3 shadow-lg sm:left-auto sm:w-96 ${
        overlay.tone === "warning"
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-fd-border bg-fd-background"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{overlay.title}</p>
          <div className="mt-1">
            <Note>{overlay.body}</Note>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
          aria-label="Dismiss overlay"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}

function StatusBar({
  view,
  entry,
  module,
  tour,
  tourIndex,
  playing,
  canPlay,
  onPrev,
  onNext,
  onTogglePlay,
}: {
  view: View;
  entry?: SearchEntry | undefined;
  module?: ModuleSummary | undefined;
  tour: Tour | null;
  tourIndex: number;
  playing: boolean;
  canPlay: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
}) {
  return (
    <footer className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-fd-border px-2 py-1 text-[11px] text-fd-muted-foreground sm:px-3">
      <span className="hidden uppercase tracking-wide sm:inline">{view}</span>
      {entry ? (
        <>
          <span className="hidden text-fd-border sm:inline">/</span>
          <span className="min-w-0 max-w-[50%] truncate sm:max-w-none">{entry.label}</span>
          {module && entry.kind !== "module" ? (
            <span className="hidden truncate text-fd-muted-foreground sm:inline">
              · {module.title}
            </span>
          ) : null}
        </>
      ) : module ? (
        <span className="min-w-0 max-w-[45%] truncate sm:max-w-none">{module.title}</span>
      ) : null}
      {view === "tours" && tour ? (
        <div className="ml-auto flex items-center gap-2">
          <span>{tourIndex < 0 ? "intro" : `${tourIndex + 1} / ${tour.steps.length}`}</span>
          <button
            type="button"
            onClick={onPrev}
            disabled={tourIndex < 0}
            className="rounded border border-fd-border px-2 py-0.5 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!canPlay}
            className="rounded border border-fd-border px-2 py-0.5 disabled:opacity-40"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={tourIndex >= tour.steps.length - 1}
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
