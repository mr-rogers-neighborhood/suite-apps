import { Boxes, ChevronRight, FolderTree, Route, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserTree } from "@/explorer/tree";
import type {
  FolderNode,
  ModuleSummary,
  SearchEntry,
  Tour,
  TourStep,
  View,
} from "@/lib/explorer-types";

type Props = {
  view: View;
  onChangeView: (view: View) => void;
  query: string;
  onChangeQuery: (value: string) => void;
  search: SearchEntry[];
  searchById: Map<string, SearchEntry>;
  moduleById: Map<string, ModuleSummary>;
  modules: ModuleSummary[];
  tree: FolderNode;
  tours: Tour[];
  tourNodes: Set<string>;
  selectedNode: string | null;
  selectedModule: string | null;
  tourId: string | null;
  tourIndex: number;
  expanded: Set<string>;
  internalOpen: Set<string>;
  onSelectNode: (id: string) => void;
  onSelectModule: (id: string) => void;
  onToggle: (path: string) => void;
  onToggleInternal: (fileId: string) => void;
  onSelectTour: (id: string) => void;
  onSelectTourStep: (index: number) => void;
  onSearchSelect: (entry: SearchEntry) => void;
  compact: boolean;
};

const viewItems: { id: View; label: string; icon: typeof FolderTree }[] = [
  { id: "browser", label: "Browser", icon: FolderTree },
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "tours", label: "Tours", icon: Route },
];

function stepLabel(
  step: TourStep,
  searchById: Map<string, SearchEntry>,
  moduleById: Map<string, ModuleSummary>,
) {
  if (step.kind === "interlude") return step.title;
  const target = step.target;
  if (target.kind === "module") return moduleById.get(target.id)?.title ?? target.id;
  if (target.kind === "tour") return `Tour: ${target.id}`;
  if (target.kind === "doc") return target.path.split("/").at(-1) ?? target.path;
  return searchById.get(target.id)?.label ?? target.id;
}

function stepModule(
  step: TourStep,
  searchById: Map<string, SearchEntry>,
  moduleById: Map<string, ModuleSummary>,
) {
  if (step.kind === "interlude") return "chapter";
  const target = step.target;
  if (target.kind === "module") return target.id;
  if (target.kind === "tour") return "another tour";
  if (target.kind === "doc") return "reference";
  const entry = searchById.get(target.id);
  return entry?.moduleId
    ? (moduleById.get(entry.moduleId)?.title ?? entry.moduleId)
    : (entry?.path ?? target.id);
}

export function ExplorerSidebar({
  view,
  onChangeView,
  query,
  onChangeQuery,
  search,
  searchById,
  moduleById,
  modules,
  tree,
  tours,
  tourNodes,
  selectedNode,
  selectedModule,
  tourId,
  tourIndex,
  expanded,
  internalOpen,
  onSelectNode,
  onSelectModule,
  onToggle,
  onToggleInternal,
  onSelectTour,
  onSelectTourStep,
  onSearchSelect,
  compact,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void view;
    void query;
    scroller.current?.scrollTo({ top: 0 });
  }, [view, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
      if (event.key === "Escape" && typing) {
        onChangeQuery("");
        input.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChangeQuery]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-fd-background">
      <div className="shrink-0 space-y-2 border-b border-fd-border p-2.5">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-fd-muted p-1">
          {viewItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeView(item.id)}
                className={`flex items-center justify-center gap-1.5 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors ${
                  view === item.id
                    ? "bg-fd-background text-fd-foreground shadow-sm"
                    : "text-fd-muted-foreground hover:text-fd-foreground"
                }`}
                aria-pressed={view === item.id}
                aria-label={compact ? item.label : undefined}
                title={compact ? item.label : undefined}
              >
                <Icon className="size-3.5" />
                {compact ? null : item.label}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 rounded-lg border border-fd-border px-2 py-1.5">
          <Search className="size-3.5 shrink-0 text-fd-muted-foreground" />
          <input
            ref={input}
            value={query}
            onChange={(event) => onChangeQuery(event.target.value)}
            placeholder={compact ? "Search…" : "Search files, symbols and tours…"}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-fd-muted-foreground"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              onClick={() => onChangeQuery("")}
              aria-label="Clear search"
              className="text-fd-muted-foreground hover:text-fd-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="rounded border border-fd-border px-1 text-[10px] text-fd-muted-foreground">
              /
            </kbd>
          )}
        </label>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {query ? (
          <SearchResults
            query={query}
            search={search}
            moduleById={moduleById}
            onSelect={onSearchSelect}
          />
        ) : view === "browser" ? (
          <BrowserTree
            tree={tree}
            selectedId={selectedNode}
            expanded={expanded}
            internalOpen={internalOpen}
            tourNodes={tourNodes}
            onSelect={onSelectNode}
            onToggle={onToggle}
            onToggleInternal={onToggleInternal}
          />
        ) : view === "modules" ? (
          <ModuleList modules={modules} selectedModule={selectedModule} onSelect={onSelectModule} />
        ) : (
          <TourList
            tours={tours}
            tourId={tourId}
            tourIndex={tourIndex}
            searchById={searchById}
            moduleById={moduleById}
            onSelectTour={onSelectTour}
            onSelectTourStep={onSelectTourStep}
          />
        )}
      </div>
    </div>
  );
}

function SearchResults({
  query,
  search,
  moduleById,
  onSelect,
}: {
  query: string;
  search: SearchEntry[];
  moduleById: Map<string, ModuleSummary>;
  onSelect: (entry: SearchEntry) => void;
}) {
  const needle = query.toLowerCase();
  const results = useMemo(
    () =>
      search
        .filter(
          (entry) =>
            entry.label.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle),
        )
        .slice(0, 60),
    [needle, search],
  );

  if (results.length === 0) {
    return <p className="p-4 text-xs text-fd-muted-foreground">No matches.</p>;
  }

  return (
    <div className="py-1">
      {results.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry)}
          className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-fd-accent"
        >
          <span className="mt-0.5 w-10 shrink-0 rounded bg-fd-muted text-center text-[9px] uppercase text-fd-muted-foreground">
            {entry.kind}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs">{entry.label}</span>
            <span className="block truncate font-mono text-[10px] text-fd-muted-foreground">
              {entry.moduleId && moduleById.get(entry.moduleId)
                ? moduleById.get(entry.moduleId)?.title
                : entry.path}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ModuleList({
  modules,
  selectedModule,
  onSelect,
}: {
  modules: ModuleSummary[];
  selectedModule: string | null;
  onSelect: (id: string) => void;
}) {
  const [gapsOnly, setGapsOnly] = useState(false);
  const withProse = modules.filter(
    (module) => Boolean(module.summary?.trim()) || module.noteCount > 0,
  ).length;
  const gaps = modules.filter((module) => !module.summary?.trim() && module.noteCount === 0).length;
  const reviewed = modules.filter((module) => module.reviewed).length;
  const groups = useMemo(() => {
    const groups = new Map<string, ModuleSummary[]>();
    for (const module of modules) {
      const group = module.virtual
        ? "Config"
        : module.id.startsWith("apps/")
          ? "Apps"
          : module.id.startsWith("packages/")
            ? "Packages"
            : "Tools";
      const list = groups.get(group) ?? [];
      list.push(module);
      groups.set(group, list);
    }
    for (const list of groups.values()) {
      list.sort((left, right) => left.title.localeCompare(right.title));
    }
    return groups;
  }, [modules]);

  return (
    <div className="py-2 text-[13px]">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-fd-border px-3 pb-2">
        <span className="text-[10px] uppercase tracking-widest text-fd-muted-foreground">
          {reviewed} reviewed · {withProse}/{modules.length} prose
        </span>
        <button
          type="button"
          onClick={() => setGapsOnly((value) => !value)}
          className={`rounded border px-1.5 py-0.5 text-[10px] ${
            gapsOnly
              ? "border-amber-500/50 bg-amber-500/10 text-amber-600"
              : "border-fd-border text-fd-muted-foreground hover:text-fd-foreground"
          }`}
          aria-pressed={gapsOnly}
        >
          needs prose {gaps}
        </button>
      </div>
      {["Apps", "Packages", "Tools", "Config"].map((group) => {
        const items = groups
          .get(group)
          ?.filter((module) => !gapsOnly || (!module.summary?.trim() && module.noteCount === 0));
        if (!items || items.length === 0) return null;
        return (
          <section key={group} className="mb-2">
            <h2 className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-fd-muted-foreground">
              {group}
            </h2>
            {items.map((module) => {
              const nested = Boolean(module.parentId) || module.kind === "submodule";
              return (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => onSelect(module.id)}
                  className={`flex w-full items-start gap-2 py-1.5 pr-3 text-left hover:bg-fd-accent ${
                    selectedModule === module.id ? "bg-fd-accent text-fd-accent-foreground" : ""
                  }`}
                  style={{ paddingLeft: nested ? 24 : 12 }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{module.title}</span>
                    <span className="block truncate font-mono text-[10px] text-fd-muted-foreground">
                      {module.id}
                    </span>
                  </span>
                  <span className="mt-0.5 shrink-0 text-[10px] text-fd-muted-foreground">
                    {module.fileCount}f
                  </span>
                  {module.tourCount > 0 ? (
                    <span
                      title={`${module.tourCount} tours`}
                      className="mt-0.5 shrink-0 rounded bg-fd-primary/10 px-1 text-[9px] text-fd-primary"
                    >
                      {module.tourCount} tour{module.tourCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {module.noteCount > 0 ? (
                    <span className="mt-0.5 shrink-0 rounded bg-amber-500/10 px-1 text-[9px] text-amber-500">
                      {module.noteCount}
                    </span>
                  ) : null}
                  {module.virtual ? (
                    <span className="mt-0.5 shrink-0 text-[9px] uppercase text-fd-muted-foreground">
                      v
                    </span>
                  ) : null}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function TourList({
  tours,
  tourId,
  tourIndex,
  searchById,
  moduleById,
  onSelectTour,
  onSelectTourStep,
}: {
  tours: Tour[];
  tourId: string | null;
  tourIndex: number;
  searchById: Map<string, SearchEntry>;
  moduleById: Map<string, ModuleSummary>;
  onSelectTour: (id: string) => void;
  onSelectTourStep: (index: number) => void;
}) {
  const tour = tours.find((candidate) => candidate.id === tourId) ?? null;

  return (
    <div className="text-[13px]">
      <div className="py-1">
        {tours.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onSelectTour(candidate.id)}
            className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-fd-accent ${
              tourId === candidate.id ? "bg-fd-accent" : ""
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">{candidate.title}</span>
                {candidate.start ? (
                  <span className="rounded bg-fd-primary/10 px-1 text-[9px] uppercase text-fd-primary">
                    start
                  </span>
                ) : null}
                {candidate.source === "generated" ? (
                  <span className="rounded bg-fd-muted px-1 text-[9px] uppercase text-fd-muted-foreground">
                    generated
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-[10px] text-fd-muted-foreground">
                {candidate.steps.length} steps
              </span>
            </span>
            <ChevronRight
              className={`mt-1 size-3.5 shrink-0 text-fd-muted-foreground transition-transform ${
                tourId === candidate.id ? "rotate-90" : ""
              }`}
            />
          </button>
        ))}
      </div>

      {tour ? (
        <div className="border-t border-fd-border pb-4">
          <TourSteps
            tour={tour}
            tourIndex={tourIndex}
            searchById={searchById}
            moduleById={moduleById}
            onSelectStep={onSelectTourStep}
          />
        </div>
      ) : null}
    </div>
  );
}

function TourSteps({
  tour,
  tourIndex,
  searchById,
  moduleById,
  onSelectStep,
}: {
  tour: Tour;
  tourIndex: number;
  searchById: Map<string, SearchEntry>;
  moduleById: Map<string, ModuleSummary>;
  onSelectStep: (index: number) => void;
}) {
  const total = tour.steps.length;
  const generated = tour.source === "generated";
  const windowSize = generated ? 44 : total;
  const start = generated ? Math.max(0, Math.min(tourIndex - 10, total - windowSize)) : 0;
  const end = Math.min(total, start + windowSize);

  return (
    <div className="py-1">
      <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-widest text-fd-muted-foreground">
        {tour.title}
        {generated ? ` · step ${Math.max(1, tourIndex + 1)} of ${total}` : ""}
      </div>
      <button
        type="button"
        onClick={() => onSelectStep(-1)}
        className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-xs hover:bg-fd-accent ${
          tourIndex < 0 ? "bg-fd-accent text-fd-accent-foreground" : ""
        }`}
        style={{ paddingLeft: 12 }}
      >
        <span className="w-7 shrink-0 text-right font-mono text-[10px] text-fd-muted-foreground">
          0
        </span>
        <span>Intro</span>
      </button>
      {start > 0 ? (
        <p className="px-3 py-1 text-[10px] text-fd-muted-foreground">
          {start} earlier step{start === 1 ? "" : "s"}
        </p>
      ) : null}
      {tour.steps.slice(start, end).map((step, offset) => {
        const index = start + offset;
        const active = index === tourIndex;
        if (step.kind === "interlude") {
          return (
            <button
              key={`interlude-${index}`}
              type="button"
              onClick={() => onSelectStep(index)}
              className={`flex w-full items-start gap-2 py-2 pr-3 text-left hover:bg-fd-accent ${
                active ? "bg-fd-accent text-fd-accent-foreground" : ""
              }`}
              style={{ paddingLeft: 12 }}
            >
              <Route className="mt-0.5 size-3.5 shrink-0 text-fd-primary/70" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{step.title}</span>
                <span className="block text-[10px] uppercase tracking-wide text-fd-muted-foreground">
                  chapter
                </span>
              </span>
            </button>
          );
        }
        return (
          <button
            key={`${index}-${stepLabel(step, searchById, moduleById)}`}
            type="button"
            onClick={() => onSelectStep(index)}
            className={`flex w-full items-start gap-2 py-1.5 pr-3 text-left hover:bg-fd-accent ${
              active ? "bg-fd-accent text-fd-accent-foreground" : ""
            }`}
            style={{ paddingLeft: 12 }}
          >
            <span className="mt-0.5 w-7 shrink-0 text-right font-mono text-[10px] text-fd-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">
                {stepLabel(step, searchById, moduleById)}
              </span>
              <span className="block truncate text-[10px] text-fd-muted-foreground">
                {stepModule(step, searchById, moduleById)}
              </span>
            </span>
          </button>
        );
      })}
      {end < total ? (
        <p className="px-3 py-1 text-[10px] text-fd-muted-foreground">
          {total - end} later step{total - end === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
