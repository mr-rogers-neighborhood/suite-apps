"use client";

import { ExternalLink, Link2, MousePointerClick } from "lucide-react";
import { CodeView } from "@/components/explorer/code-view";
import { Note } from "@/components/explorer/note";
import type { ModuleData, ModuleSummary, SearchEntry, View, Walk } from "@/lib/explorer-types";

type Props = {
  view: View;
  currentNodeId: string | null;
  selectedModule: string | null;
  walk: Walk | null;
  stepIndex: number;
  moduleData: Record<string, ModuleData>;
  searchById: Map<string, SearchEntry>;
  moduleById: Map<string, ModuleSummary>;
  onSelectNode: (id: string) => void;
  onSelectModule: (id: string) => void;
  onOpenBrowser: (id: string) => void;
  onSelectWalkStep: (index: number) => void;
};

const GITHUB = "https://github.com/mr-rogers-neighborhood/suite-apps/blob/main";

function sourceUrl(fileId: string, line?: number) {
  return `${GITHUB}/${fileId}${line ? `#L${line}` : ""}`;
}

function kindLabel(kind: string) {
  if (kind === "file") return "file";
  if (kind === "module") return "module";
  if (kind === "walk") return "walkthrough";
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

export function DetailPane({
  view,
  currentNodeId,
  selectedModule,
  walk,
  stepIndex,
  moduleData,
  searchById,
  moduleById,
  onSelectNode,
  onSelectModule,
  onOpenBrowser,
  onSelectWalkStep,
}: Props) {
  if (view === "modules" && selectedModule) {
    return (
      <ModuleDetail
        moduleId={selectedModule}
        moduleData={moduleData}
        moduleById={moduleById}
        onSelectNode={onSelectNode}
        onOpenBrowser={onOpenBrowser}
      />
    );
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
          onSelectNode={onSelectNode}
          onOpenBrowser={onOpenBrowser}
        />
      );
    }
    return (
      <NodeDetail
        entry={entry}
        view={view}
        walk={walk}
        stepIndex={stepIndex}
        moduleData={moduleData}
        moduleById={moduleById}
        onSelectNode={onSelectNode}
        onSelectModule={onSelectModule}
        onOpenBrowser={onOpenBrowser}
        onSelectWalkStep={onSelectWalkStep}
      />
    );
  }

  if (view === "walkthroughs" && walk) {
    return (
      <WalkOverview
        walk={walk}
        moduleById={moduleById}
        searchById={searchById}
        onStart={() => onSelectWalkStep(0)}
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
              : "Pick a walkthrough"}
        </p>
        <p className="text-sm text-fd-muted-foreground">
          The left rail is the navigator. The right pane is the document.
        </p>
      </div>
    </div>
  );
}

function Missing({ id }: { id: string }) {
  return (
    <div className="p-8 text-sm text-fd-muted-foreground">
      The index does not know <code>{id}</code>. Run <code>pnpm docs:index</code>.
    </div>
  );
}

function WalkOverview({
  walk,
  moduleById,
  searchById,
  onStart,
}: {
  walk: Walk;
  moduleById: Map<string, ModuleSummary>;
  searchById: Map<string, SearchEntry>;
  onStart: () => void;
}) {
  const first = searchById.get(walk.steps[0]?.node ?? "");
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-fd-muted-foreground">Walkthrough</p>
        <h1 className="text-3xl font-bold tracking-tight">{walk.title}</h1>
        <p className="text-sm leading-6 text-fd-muted-foreground">{walk.summary}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{walk.generated ? "generated" : "curated"}</Badge>
        <Badge>{walk.steps.length} steps</Badge>
        {walk.start ? <Badge>start here</Badge> : null}
      </div>
      <button
        type="button"
        onClick={onStart}
        className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground hover:opacity-90"
      >
        Start at step 1
      </button>
      {first ? (
        <p className="text-xs text-fd-muted-foreground">
          First stop: {first.label} ·{" "}
          {first.moduleId ? (moduleById.get(first.moduleId)?.title ?? first.moduleId) : "file"}
        </p>
      ) : null}
    </div>
  );
}

function ModuleDetail({
  moduleId,
  moduleData,
  moduleById,
  onSelectNode,
  onOpenBrowser,
}: {
  moduleId: string;
  moduleData: Record<string, ModuleData>;
  moduleById: Map<string, ModuleSummary>;
  onSelectNode: (id: string) => void;
  onOpenBrowser: (id: string) => void;
}) {
  const summary = moduleById.get(moduleId);
  const module = moduleData[moduleId];
  if (!summary) return <Missing id={moduleId} />;
  if (!module) return <Loading label="module" />;

  const children = [...moduleById.values()].filter((candidate) => candidate.parentId === module.id);
  return (
    <article className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="space-y-3 border-b border-fd-border pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{module.kind}</Badge>
          {module.virtual ? <Badge>virtual</Badge> : null}
          <Badge>{module.fileCount} files</Badge>
          <Badge>{module.symbolCount} symbols</Badge>
          <Badge>{module.noteCount} notes</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{module.title}</h1>
        <p className="font-mono text-xs text-fd-muted-foreground">{module.id}</p>
        {module.summary ? <Note>{module.summary}</Note> : null}
        {module.note ? <Note>{module.note}</Note> : null}
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
  view,
  walk,
  stepIndex,
  moduleData,
  moduleById,
  onSelectNode,
  onSelectModule,
  onOpenBrowser,
  onSelectWalkStep,
}: {
  entry: SearchEntry;
  view: View;
  walk: Walk | null;
  stepIndex: number;
  moduleData: Record<string, ModuleData>;
  moduleById: Map<string, ModuleSummary>;
  onSelectNode: (id: string) => void;
  onSelectModule: (id: string) => void;
  onOpenBrowser: (id: string) => void;
  onSelectWalkStep: (index: number) => void;
}) {
  const moduleId = entry.moduleId;
  const module = moduleId ? moduleData[moduleId] : undefined;
  if (moduleId && !module) return <Loading label="module" />;

  const file =
    module?.files.find((candidate) => candidate.id === entry.path || candidate.id === entry.id) ??
    undefined;
  const symbol = file?.symbols.find((candidate) => candidate.id === entry.id);
  const step = walk?.steps[stepIndex];
  const stepNote = step?.node === entry.id ? step.note : undefined;
  const note = stepNote ?? symbol?.note ?? file?.note ?? "";
  const jsdoc = !note && symbol?.jsdoc ? symbol.jsdoc : "";
  const moduleTitle = moduleId ? (moduleById.get(moduleId)?.title ?? moduleId) : "config";
  const title = symbol?.name ?? file?.name ?? entry.label;
  const lineStart = symbol?.startLine ?? 1;
  const lineEnd = symbol?.endLine ?? file?.lineCount ?? 1;

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
          {symbol ? <span>/</span> : null}
          {symbol ? <span className="text-fd-foreground">{symbol.name}</span> : null}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{kindLabel(entry.kind)}</Badge>
          {symbol?.visibility && symbol.visibility !== "export" ? (
            <Badge>{symbol.visibility}</Badge>
          ) : null}
          {symbol?.tags.map((tag) => (
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
                {symbol ? "Definition" : "Source"}
              </h2>
              <div className="flex gap-2">
                <LinkButton href={sourceUrl(file.id, symbol?.startLine)}>
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
              highlight={Boolean(symbol)}
            />
          </section>
        ) : null}

        {file && !symbol ? (
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

        {walk && step ? (
          <div className="flex items-center justify-between border-t border-fd-border pt-3 text-xs text-fd-muted-foreground">
            <span>
              Step {stepIndex + 1} of {walk.steps.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={stepIndex === 0}
                onClick={() => onSelectWalkStep(stepIndex - 1)}
                className="rounded border border-fd-border px-2 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={stepIndex >= walk.steps.length - 1}
                onClick={() => onSelectWalkStep(stepIndex + 1)}
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
