"use client";

import { Boxes, ChevronRight, FolderTree, Route, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { BrowserTree } from "@/components/explorer/tree";
import type { FolderNode, ModuleSummary, SearchEntry, View, Walk } from "@/lib/explorer-types";

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
  walks: Walk[];
  selectedNode: string | null;
  selectedModule: string | null;
  walkId: string | null;
  stepIndex: number;
  expanded: Set<string>;
  internalOpen: Set<string>;
  onSelectNode: (id: string) => void;
  onSelectModule: (id: string) => void;
  onToggle: (path: string) => void;
  onToggleInternal: (fileId: string) => void;
  onSelectWalk: (id: string) => void;
  onSelectStep: (index: number) => void;
  onSearchSelect: (entry: SearchEntry) => void;
};

const viewItems: { id: View; label: string; icon: typeof FolderTree }[] = [
  { id: "browser", label: "Browser", icon: FolderTree },
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "walkthroughs", label: "Walkthroughs", icon: Route },
];

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
  walks,
  selectedNode,
  selectedModule,
  walkId,
  stepIndex,
  expanded,
  internalOpen,
  onSelectNode,
  onSelectModule,
  onToggle,
  onToggleInternal,
  onSelectWalk,
  onSelectStep,
  onSearchSelect,
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
              >
                <Icon className="size-3.5" />
                {item.label}
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
            placeholder="Search files and symbols…"
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
            onSelect={onSelectNode}
            onToggle={onToggle}
            onToggleInternal={onToggleInternal}
          />
        ) : view === "modules" ? (
          <ModuleList modules={modules} selectedModule={selectedModule} onSelect={onSelectModule} />
        ) : (
          <WalkList
            walks={walks}
            walkId={walkId}
            stepIndex={stepIndex}
            searchById={searchById}
            moduleById={moduleById}
            onSelectWalk={onSelectWalk}
            onSelectStep={onSelectStep}
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
      {["Apps", "Packages", "Tools", "Config"].map((group) => {
        const items = groups.get(group);
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

function WalkList({
  walks,
  walkId,
  stepIndex,
  searchById,
  moduleById,
  onSelectWalk,
  onSelectStep,
}: {
  walks: Walk[];
  walkId: string | null;
  stepIndex: number;
  searchById: Map<string, SearchEntry>;
  moduleById: Map<string, ModuleSummary>;
  onSelectWalk: (id: string) => void;
  onSelectStep: (index: number) => void;
}) {
  const walk = walks.find((candidate) => candidate.id === walkId) ?? null;

  return (
    <div className="text-[13px]">
      <div className="py-1">
        {walks.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onSelectWalk(candidate.id)}
            className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-fd-accent ${
              walkId === candidate.id ? "bg-fd-accent" : ""
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
              </span>
              <span className="mt-0.5 block text-[10px] text-fd-muted-foreground">
                {candidate.steps.length} steps · {candidate.generated ? "generated" : "curated"}
              </span>
            </span>
            <ChevronRight
              className={`mt-1 size-3.5 shrink-0 text-fd-muted-foreground transition-transform ${
                walkId === candidate.id ? "rotate-90" : ""
              }`}
            />
          </button>
        ))}
      </div>

      {walk ? (
        <div className="border-t border-fd-border pb-4">
          <WalkSteps
            walk={walk}
            stepIndex={stepIndex}
            searchById={searchById}
            moduleById={moduleById}
            onSelectStep={onSelectStep}
          />
        </div>
      ) : null}
    </div>
  );
}

function WalkSteps({
  walk,
  stepIndex,
  searchById,
  moduleById,
  onSelectStep,
}: {
  walk: Walk;
  stepIndex: number;
  searchById: Map<string, SearchEntry>;
  moduleById: Map<string, ModuleSummary>;
  onSelectStep: (index: number) => void;
}) {
  const total = walk.steps.length;
  const windowSize = walk.generated ? 44 : total;
  const start = walk.generated ? Math.max(0, Math.min(stepIndex - 10, total - windowSize)) : 0;
  const end = Math.min(total, start + windowSize);

  return (
    <div className="py-1">
      <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-widest text-fd-muted-foreground">
        {walk.title}
        {walk.generated ? ` · step ${stepIndex + 1} of ${total}` : ""}
      </div>
      {start > 0 ? (
        <p className="px-3 py-1 text-[10px] text-fd-muted-foreground">
          {start} earlier step{start === 1 ? "" : "s"}
        </p>
      ) : null}
      {walk.steps.slice(start, end).map((step, offset) => {
        const index = start + offset;
        const entry = searchById.get(step.node);
        const module = entry?.moduleId ? moduleById.get(entry.moduleId) : undefined;
        return (
          <button
            key={`${step.node}-${index}`}
            type="button"
            onClick={() => onSelectStep(index)}
            className={`flex w-full items-start gap-2 py-1.5 pr-3 text-left hover:bg-fd-accent ${
              index === stepIndex ? "bg-fd-accent text-fd-accent-foreground" : ""
            }`}
            style={{ paddingLeft: 12 }}
          >
            <span className="mt-0.5 w-7 shrink-0 text-right font-mono text-[10px] text-fd-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">{entry?.label ?? step.node}</span>
              <span className="block truncate text-[10px] text-fd-muted-foreground">
                {module?.title ?? entry?.path ?? "unknown"}
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
