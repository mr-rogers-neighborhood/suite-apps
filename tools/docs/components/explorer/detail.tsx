"use client";

import { ExternalLink, Link2, MousePointerClick } from "lucide-react";
import { CodeView } from "@/components/explorer/code-view";
import { Note } from "@/components/explorer/note";
import type {
  ModuleData,
  ModuleSummary,
  SearchEntry,
  Tour,
  TourMembership,
  TourNodeStep,
  TourStep,
  View,
} from "@/lib/explorer-types";

type Props = {
  view: View;
  currentNodeId: string | null;
  selectedModule: string | null;
  tour: Tour | null;
  tourIndex: number;
  detailLevel: "file" | "symbol" | null;
  moduleData: Record<string, ModuleData>;
  searchById: Map<string, SearchEntry>;
  moduleById: Map<string, ModuleSummary>;
  membership: TourMembership;
  onSelectNode: (id: string) => void;
  onSelectModule: (id: string) => void;
  onOpenBrowser: (id: string) => void;
  onSelectTourStep: (index: number) => void;
  onStartTour: () => void;
  onOpenTour: (id: string, step: number) => void;
};

const GITHUB = "https://github.com/mr-rogers-neighborhood/suite-apps/blob/main";

function sourceUrl(fileId: string, line?: number) {
  return `${GITHUB}/${fileId}${line ? `#L${line}` : ""}`;
}

function kindLabel(kind: string) {
  if (kind === "file") return "file";
  if (kind === "module") return "module";
  if (kind === "tour") return "tour";
  return kind;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-fd-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fd-muted-foreground">
      {children}
    </span>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-fd-border px-2.5 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
    >
      {children}
    </a>
  );
}

function CopyLink() {
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(window.location.href)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-fd-border px-2.5 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
    >
      <Link2 className="size-3.5" />
      Copy link
    </button>
  );
}

function stepTitle(step: TourStep, searchById: Map<string, SearchEntry>): string {
  if (step.kind === "interlude") return step.title;
  const target = step.target;
  if (target.kind === "module") return searchById.get(target.id)?.label ?? target.id;
  if (target.kind === "tour") return `Tour: ${target.id}`;
  if (target.kind === "doc") return target.path.split("/").at(-1) ?? target.path;
  return searchById.get(target.id)?.label ?? target.id;
}

function tourOutline(tour: Tour, searchById: Map<string, SearchEntry>) {
  if (tour.source === "generated") return [];
  const chapters: Array<{ title: string; steps: Array<{ index: number; title: string }> }> = [];
  let current = { title: "Opening", steps: [] as Array<{ index: number; title: string }> };
  tour.steps.forEach((step, index) => {
    if (step.kind === "interlude") {
      if (current.steps.length > 0) chapters.push(current);
      current = { title: step.title, steps: [] };
      return;
    }
    current.steps.push({ index, title: stepTitle(step, searchById) });
  });
  if (current.steps.length > 0) chapters.push(current);
  return chapters;
}

function ToursHere({
  membership,
  ids,
  onOpenTour,
}: {
  membership: TourMembership;
  ids: readonly string[];
  onOpenTour: (id: string, step: number) => void;
}) {
  const seen = new Set<string>();
  const entries = [];
  for (const id of ids) {
    for (const entry of membership[id] ?? []) {
      if (seen.has(entry.tourId)) continue;
      seen.add(entry.tourId);
      entries.push(entry);
    }
  }
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
        Tours
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <button
            key={`${entry.tourId}:${entry.step}`}
            type="button"
            onClick={() => onOpenTour(entry.tourId, entry.step)}
            className="rounded-lg border border-fd-border px-3 py-1.5 text-left text-xs hover:bg-fd-accent"
          >
            <span className="block font-medium">{entry.title}</span>
            <span className="block text-[10px] text-fd-muted-foreground">
              step {entry.step + 1}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function DetailPane({
  view,
  currentNodeId,
  selectedModule,
  tour,
  tourIndex,
  detailLevel,
  moduleData,
  searchById,
  moduleById,
  membership,
  onSelectNode,
  onSelectModule,
  onOpenBrowser,
  onSelectTourStep,
  onStartTour,
  onOpenTour,
}: Props) {
  if (view === "modules" && selectedModule) {
    return (
      <ModuleDetail
        moduleId={selectedModule}
        moduleData={moduleData}
        moduleById={moduleById}
        membership={membership}
        onSelectNode={onSelectNode}
        onOpenBrowser={onOpenBrowser}
        onOpenTour={onOpenTour}
      />
    );
  }

  if (view === "tours" && tour) {
    if (tourIndex < 0) {
      return (
        <TourIntro
          tour={tour}
          searchById={searchById}
          onStart={onStartTour}
          onSelectStep={onSelectTourStep}
        />
      );
    }
    const step = tour.steps[tourIndex];
    if (!step) {
      return (
        <TourIntro
          tour={tour}
          searchById={searchById}
          onStart={onStartTour}
          onSelectStep={onSelectTourStep}
        />
      );
    }
    if (step.kind === "interlude") {
      return (
        <TourInterlude
          tour={tour}
          step={step}
          index={tourIndex}
          onPrev={() => onSelectTourStep(tourIndex - 1)}
          onNext={() => onSelectTourStep(tourIndex + 1)}
        />
      );
    }
  }

  if (currentNodeId) {
    const entry = searchById.get(currentNodeId);
    if (!entry) return <Missing id={currentNodeId} />;
    if (entry.kind === "module") {
      return (
        <ModuleDetail
          moduleId={entry.id}
          moduleData={moduleData}
          moduleById={moduleById}
          membership={membership}
          tourStep={view === "tours" ? tourStepOf(tour, tourIndex) : undefined}
          onSelectNode={onSelectNode}
          onOpenBrowser={onOpenBrowser}
          onOpenTour={onOpenTour}
        />
      );
    }
    if (detailLevel === "file" && entry.kind !== "file") {
      const fileEntry = searchById.get(entry.path);
      if (fileEntry?.kind === "file") {
        return (
          <NodeDetail
            entry={fileEntry}
            focusSymbolId={entry.id}
            view={view}
            tour={tour}
            tourIndex={tourIndex}
            tourStep={view === "tours" ? tourStepOf(tour, tourIndex) : undefined}
            moduleData={moduleData}
            moduleById={moduleById}
            membership={membership}
            onSelectNode={onSelectNode}
            onSelectModule={onSelectModule}
            onOpenBrowser={onOpenBrowser}
            onSelectTourStep={onSelectTourStep}
            onOpenTour={onOpenTour}
          />
        );
      }
    }
    return (
      <NodeDetail
        entry={entry}
        view={view}
        tour={tour}
        tourIndex={tourIndex}
        tourStep={view === "tours" ? tourStepOf(tour, tourIndex) : undefined}
        moduleData={moduleData}
        moduleById={moduleById}
        membership={membership}
        onSelectNode={onSelectNode}
        onSelectModule={onSelectModule}
        onOpenBrowser={onOpenBrowser}
        onSelectTourStep={onSelectTourStep}
        onOpenTour={onOpenTour}
      />
    );
  }

  if (view === "tours" && tour) {
    return (
      <TourIntro
        tour={tour}
        searchById={searchById}
        onStart={onStartTour}
        onSelectStep={onSelectTourStep}
      />
    );
  }

  return (
    <div className="grid min-h-full place-items-center p-10 text-center">
      <div className="max-w-md space-y-2">
        <p className="text-sm font-medium text-fd-foreground">
          {view === "browser"
            ? "Pick a file or symbol"
            : view === "modules"
              ? "Pick a module"
              : "Pick a tour"}
        </p>
        <p className="text-sm text-fd-muted-foreground">
          The left rail is the navigator. The right pane is the document.
        </p>
      </div>
    </div>
  );
}

function tourStepOf(tour: Tour | null, index: number): TourNodeStep | undefined {
  if (!tour || index < 0) return undefined;
  const step = tour.steps[index];
  return step?.kind === "node" ? step : undefined;
}

function Missing({ id }: { id: string }) {
  return (
    <div className="p-8 text-sm text-fd-muted-foreground">
      The index does not know <code>{id}</code>. Run <code>pnpm docs:index</code>.
    </div>
  );
}

function TourIntro({
  tour,
  searchById,
  onStart,
  onSelectStep,
}: {
  tour: Tour;
  searchById: Map<string, SearchEntry>;
  onStart: () => void;
  onSelectStep: (index: number) => void;
}) {
  const chapters = tourOutline(tour, searchById);
  return (
    <article className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="space-y-3 border-b border-fd-border pb-5">
        <p className="text-xs uppercase tracking-widest text-fd-muted-foreground">Tour</p>
        <h1 className="text-3xl font-bold tracking-tight">{tour.title}</h1>
        <p className="text-sm leading-6 text-fd-muted-foreground">{tour.summary}</p>
        <div className="flex flex-wrap items-center gap-2">
          {tour.start ? <Badge>start here</Badge> : null}
          <Badge>{tour.steps.length} steps</Badge>
          {tour.source === "generated" ? <Badge>generated</Badge> : null}
        </div>
      </header>

      {tour.intro ? <Note>{tour.intro}</Note> : null}

      <button
        type="button"
        onClick={onStart}
        className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground hover:opacity-90"
      >
        Start
      </button>

      <section className="space-y-4">
        {chapters.length > 0 ? (
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
            What it covers
          </h2>
        ) : null}
        {chapters.map((chapter) => (
          <div key={chapter.title} className="space-y-1.5">
            <h3 className="text-sm font-medium">{chapter.title}</h3>
            <ol className="space-y-1">
              {chapter.steps.map((entry) => (
                <li key={`${entry.index}-${entry.title}`}>
                  <button
                    type="button"
                    onClick={() => onSelectStep(entry.index)}
                    className="flex w-full items-baseline gap-2 text-left text-sm text-fd-muted-foreground hover:text-fd-foreground"
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-[10px]">
                      {entry.index + 1}
                    </span>
                    <span>{entry.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
    </article>
  );
}

function TourInterlude({
  tour,
  step,
  index,
  onPrev,
  onNext,
}: {
  tour: Tour;
  step: Extract<TourStep, { kind: "interlude" }>;
  index: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <article className="mx-auto max-w-3xl space-y-5 p-8">
      <header className="space-y-2 border-b border-fd-border pb-5">
        <p className="text-xs uppercase tracking-widest text-fd-muted-foreground">Interlude</p>
        <h1 className="text-3xl font-bold tracking-tight">{step.title}</h1>
      </header>
      <Note>{step.body}</Note>
      <div className="flex items-center justify-between border-t border-fd-border pt-3 text-xs text-fd-muted-foreground">
        <span>
          {index + 1} of {tour.steps.length}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={index === 0}
            onClick={onPrev}
            className="rounded border border-fd-border px-2 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={index >= tour.steps.length - 1}
            onClick={onNext}
            className="rounded border border-fd-border px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </article>
  );
}

function ModuleDetail({
  moduleId,
  moduleData,
  moduleById,
  membership,
  tourStep,
  onSelectNode,
  onOpenBrowser,
  onOpenTour,
}: {
  moduleId: string;
  moduleData: Record<string, ModuleData>;
  moduleById: Map<string, ModuleSummary>;
  membership: TourMembership;
  tourStep?: TourNodeStep;
  onSelectNode: (id: string) => void;
  onOpenBrowser: (id: string) => void;
  onOpenTour: (id: string, step: number) => void;
}) {
  const summary = moduleById.get(moduleId);
  const module = moduleData[moduleId];
  if (!summary) return <Missing id={moduleId} />;
  if (!module) return <Loading label="module" />;

  const children = [...moduleById.values()].filter((candidate) => candidate.parentId === module.id);
  const ids = [
    module.id,
    ...module.files.map((file) => file.id),
    ...module.files.flatMap((file) => file.symbols.map((symbol) => symbol.id)),
  ];
  return (
    <article className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="space-y-3 border-b border-fd-border pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{module.kind}</Badge>
          {module.virtual ? <Badge>virtual</Badge> : null}
          <Badge>{module.fileCount} files</Badge>
          <Badge>{module.symbolCount} symbols</Badge>
          <Badge>{module.noteCount} notes</Badge>
          {module.tourCount > 0 ? <Badge>{module.tourCount} tours</Badge> : null}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{module.title}</h1>
        <p className="font-mono text-xs text-fd-muted-foreground">{module.id}</p>
        {module.summary ? <Note>{module.summary}</Note> : null}
        {module.note ? <Note>{module.note}</Note> : null}
        {tourStep?.note ? <Note>{tourStep.note}</Note> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => module.files[0] && onOpenBrowser(module.files[0].id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-fd-border px-2.5 py-1 text-xs hover:bg-fd-accent"
          >
            <MousePointerClick className="size-3.5" />
            Open first file in Browser
          </button>
        </div>
      </header>

      <ToursHere membership={membership} ids={ids} onOpenTour={onOpenTour} />

      {children.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
            Submodules
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onSelectNode(child.id)}
                className="rounded-lg border border-fd-border p-3 text-left hover:bg-fd-accent"
              >
                <span className="block text-sm font-medium">{child.title}</span>
                <span className="block text-xs text-fd-muted-foreground">
                  {child.fileCount} files · {child.symbolCount} symbols
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
          Files
        </h2>
        <div className="divide-y divide-fd-border rounded-xl border border-fd-border">
          {module.files.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => onOpenBrowser(file.id)}
              className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-fd-accent"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.id}</span>
              <span className="text-xs text-fd-muted-foreground">{file.symbols.length} sym</span>
              {file.tests.length > 0 ? (
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-500">
                  {file.tests.length} test
                </span>
              ) : null}
              {file.note ? (
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
                  note
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>
    </article>
  );
}

function NodeDetail({
  entry,
  focusSymbolId,
  view,
  tour,
  tourIndex,
  tourStep,
  moduleData,
  moduleById,
  membership,
  onSelectNode,
  onSelectModule,
  onOpenBrowser,
  onSelectTourStep,
  onOpenTour,
}: {
  entry: SearchEntry;
  focusSymbolId?: string;
  view: View;
  tour: Tour | null;
  tourIndex: number;
  tourStep?: TourNodeStep;
  moduleData: Record<string, ModuleData>;
  moduleById: Map<string, ModuleSummary>;
  membership: TourMembership;
  onSelectNode: (id: string) => void;
  onSelectModule: (id: string) => void;
  onOpenBrowser: (id: string) => void;
  onSelectTourStep: (index: number) => void;
  onOpenTour: (id: string, step: number) => void;
}) {
  const moduleId = entry.moduleId;
  const module = moduleId ? moduleData[moduleId] : undefined;
  if (moduleId && !module) return <Loading label="module" />;

  const file =
    module?.files.find((candidate) => candidate.id === entry.path || candidate.id === entry.id) ??
    undefined;
  const focusSymbol = focusSymbolId
    ? file?.symbols.find((candidate) => candidate.id === focusSymbolId)
    : undefined;
  const symbol = focusSymbolId
    ? undefined
    : file?.symbols.find((candidate) => candidate.id === entry.id);
  const activeSymbol = symbol ?? focusSymbol;
  const durableNote = activeSymbol?.note ?? file?.note ?? "";
  const note = tourStep?.note ?? durableNote;
  const jsdoc = !note && activeSymbol?.jsdoc ? activeSymbol.jsdoc : "";
  const moduleTitle = moduleId ? (moduleById.get(moduleId)?.title ?? moduleId) : "config";
  const title = symbol?.name ?? file?.name ?? entry.label;
  const lineStart = activeSymbol?.startLine ?? 1;
  const lineEnd = activeSymbol?.endLine ?? file?.lineCount ?? 1;
  const membershipIds = symbol
    ? [symbol.id, entry.path, moduleId ?? ""]
    : file
      ? [file.id, ...file.symbols.map((candidate) => candidate.id), moduleId ?? ""]
      : [entry.id];

  return (
    <article className="mx-auto max-w-5xl p-8">
      <header className="space-y-3 border-b border-fd-border pb-5">
        <nav className="flex flex-wrap items-center gap-1 text-xs text-fd-muted-foreground">
          {moduleId ? (
            <button
              type="button"
              onClick={() => onSelectModule(moduleId)}
              className="hover:text-fd-foreground"
            >
              {moduleTitle}
            </button>
          ) : null}
          {file ? <span>/</span> : null}
          {file ? (
            <button
              type="button"
              onClick={() => onSelectNode(file.id)}
              className="font-mono hover:text-fd-foreground"
            >
              {file.name}
            </button>
          ) : null}
          {activeSymbol ? <span>/</span> : null}
          {activeSymbol ? <span className="text-fd-foreground">{activeSymbol.name}</span> : null}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{kindLabel(entry.kind)}</Badge>
          {activeSymbol?.visibility && activeSymbol.visibility !== "export" ? (
            <Badge>{activeSymbol.visibility}</Badge>
          ) : null}
          {activeSymbol?.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
          <Badge>{note ? "authored" : jsdoc ? "JSDoc" : "generated"}</Badge>
          {file && file.tests.length > 0 ? <Badge>{file.tests.length} tests</Badge> : null}
        </div>

        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {symbol ? (
          <pre className="overflow-auto rounded-lg border border-fd-border bg-fd-muted p-3 font-mono text-xs text-fd-muted-foreground">
            {symbol.signature}
          </pre>
        ) : null}
        <p className="font-mono text-xs text-fd-muted-foreground">{entry.id}</p>
      </header>

      <div className="mt-5 space-y-5">
        {note ? <Note>{note}</Note> : null}
        {tourStep?.note && durableNote && durableNote !== tourStep.note ? (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-fd-muted-foreground">
              From the module note
            </p>
            <Note>{durableNote}</Note>
          </div>
        ) : null}
        {jsdoc ? (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-fd-muted-foreground">
              From JSDoc
            </p>
            <Note>{jsdoc}</Note>
          </div>
        ) : null}
        {!note && !jsdoc ? (
          <p className="rounded-lg border border-dashed border-fd-border p-4 text-sm text-fd-muted-foreground">
            No authored note yet. This entry is generated from the compiler. Add a section to the
            module MDX to explain the why.
          </p>
        ) : null}

        <ToursHere membership={membership} ids={membershipIds} onOpenTour={onOpenTour} />

        <section className="grid gap-2 rounded-xl border border-fd-border p-4 text-xs text-fd-muted-foreground sm:grid-cols-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Module</span>
            <button
              type="button"
              onClick={() => moduleId && onSelectModule(moduleId)}
              className="mt-1 block text-left text-fd-foreground hover:underline"
            >
              {moduleTitle}
            </button>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Imported by</span>
            <span className="mt-1 block text-fd-foreground">{file?.usedBy ?? 0} files</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Tests</span>
            <span className="mt-1 block text-fd-foreground">{file?.tests.length ?? 0} files</span>
          </div>
        </section>

        {file ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
                {activeSymbol ? "Definition" : "Source"}
              </h2>
              <div className="flex gap-2">
                <LinkButton href={sourceUrl(file.id, activeSymbol?.startLine)}>
                  <ExternalLink className="size-3.5" />
                  GitHub
                </LinkButton>
                <CopyLink />
                {view !== "browser" ? (
                  <button
                    type="button"
                    onClick={() => onOpenBrowser(entry.id)}
                    className="rounded-lg border border-fd-border px-2.5 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
                  >
                    Open in Browser
                  </button>
                ) : null}
              </div>
            </div>
            <CodeView
              fileId={file.id}
              source={file.source}
              startLine={lineStart}
              endLine={lineEnd}
              highlight={Boolean(activeSymbol)}
            />
          </section>
        ) : null}

        {file && !activeSymbol ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
              Symbols
            </h2>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {file.symbols
                .filter((candidate) => candidate.exported)
                .map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => onSelectNode(candidate.id)}
                    className="flex items-center gap-2 rounded-lg border border-fd-border px-3 py-2 text-left hover:bg-fd-accent"
                  >
                    <span className="rounded bg-fd-muted px-1.5 py-0.5 text-[10px] text-fd-muted-foreground">
                      {candidate.kind}
                    </span>
                    <span className="truncate text-sm">{candidate.name}</span>
                  </button>
                ))}
            </div>
          </section>
        ) : null}

        {file && (file.imports.length > 0 || file.tests.length > 0) ? (
          <section className="grid gap-4 sm:grid-cols-2">
            {file.imports.length > 0 ? (
              <div className="space-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
                  Imports
                </h2>
                {file.imports.slice(0, 12).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectNode(id)}
                    className="block max-w-full truncate text-left font-mono text-xs text-fd-muted-foreground hover:text-fd-foreground"
                  >
                    {id}
                  </button>
                ))}
                {file.imports.length > 12 ? (
                  <p className="text-xs text-fd-muted-foreground">
                    +{file.imports.length - 12} more
                  </p>
                ) : null}
              </div>
            ) : null}
            {file.tests.length > 0 ? (
              <div className="space-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
                  Tests
                </h2>
                {file.tests.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectNode(id)}
                    className="block max-w-full truncate text-left font-mono text-xs text-fd-muted-foreground hover:text-fd-foreground"
                  >
                    {id}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "tours" && tour && tourIndex >= 0 ? (
          <div className="flex items-center justify-between border-t border-fd-border pt-3 text-xs text-fd-muted-foreground">
            <span>
              Step {tourIndex + 1} of {tour.steps.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={tourIndex === 0}
                onClick={() => onSelectTourStep(tourIndex - 1)}
                className="rounded border border-fd-border px-2 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={tourIndex >= tour.steps.length - 1}
                onClick={() => onSelectTourStep(tourIndex + 1)}
                className="rounded border border-fd-border px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-full place-items-center p-10 text-sm text-fd-muted-foreground">
      Loading {label}…
    </div>
  );
}
