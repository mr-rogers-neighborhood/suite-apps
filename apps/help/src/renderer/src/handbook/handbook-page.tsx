import type { Node, Root } from "fumadocs-core/page-tree";
import { ChevronRight, ExternalLink, GitBranch, Search, X } from "lucide-react";
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";

import { filterHandbookSearch, type HandbookSearchEntry } from "@/lib/handbook-search";
import { source } from "@/lib/source";

/** The shell every handbook page shares: header, page tree, article, contents. */
export function HandbookPage() {
  const location = useLocation();
  const slugs = location.pathname
    .replace(/^\/handbook\/?/u, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  const page = source.getPage(slugs);
  const tree = source.getPageTree();
  const searchIndex = useHandbookSearch();
  const [query, setQuery] = useState("");
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const results = useMemo(() => filterHandbookSearch(searchIndex, query), [query, searchIndex]);

  useEffect(() => {
    setNavigatorOpen(false);
  }, []);

  return (
    <div className="min-h-dvh bg-fd-background text-fd-foreground">
      <a
        href="#handbook-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-fd-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 border-b border-fd-border bg-fd-background/95 px-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setNavigatorOpen((open) => !open)}
          className="rounded-lg p-1.5 text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground md:hidden"
          aria-label="Toggle handbook navigator"
          aria-controls="handbook-sidebar"
          aria-expanded={navigatorOpen}
        >
          {navigatorOpen ? <X className="size-4" /> : <MenuIcon />}
        </button>
        <Link to="/explore" className="font-semibold tracking-tight">
          Suite Help
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-xs text-fd-muted-foreground">
          <Link
            to="/explore"
            className="rounded-lg px-2 py-1.5 hover:bg-fd-accent hover:text-fd-foreground"
          >
            Explorer
          </Link>
          <Link
            to="/handbook"
            className="rounded-lg bg-fd-accent px-2 py-1.5 font-medium text-fd-accent-foreground"
          >
            Handbook
          </Link>
          <Link
            to="/explore?view=tours"
            className="rounded-lg px-2 py-1.5 hover:bg-fd-accent hover:text-fd-foreground"
          >
            Tours
          </Link>
          <a
            href="https://github.com/mr-rogers-neighborhood/suite-apps"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-1.5 hover:bg-fd-accent"
            aria-label="GitHub"
          >
            <GitBranch className="size-4" />
          </a>
        </nav>
      </header>

      <div className="flex min-h-[calc(100dvh-3.5rem)] pt-14">
        {navigatorOpen ? (
          <button
            type="button"
            aria-label="Close handbook navigator"
            onClick={() => setNavigatorOpen(false)}
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
          />
        ) : null}
        <aside
          id="handbook-sidebar"
          aria-label="Handbook contents"
          className={
            navigatorOpen
              ? "fixed inset-y-14 left-0 z-40 w-[20rem] overflow-y-auto border-r border-fd-border bg-fd-background p-3 shadow-xl md:static md:z-auto md:block md:w-72 md:shrink-0 md:shadow-none"
              : "sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-72 shrink-0 overflow-y-auto border-r border-fd-border p-3 md:block"
          }
        >
          <label className="flex items-center gap-2 rounded-lg border border-fd-border px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-fd-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the handbook…"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-fd-muted-foreground"
              spellCheck={false}
              aria-label="Search the handbook"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-fd-muted-foreground hover:text-fd-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>

          {query ? (
            <SearchResults entries={results} onNavigate={() => setQuery("")} />
          ) : (
            <nav className="mt-3 text-[13px]">
              <TreeChildren nodes={tree.children} pathname={location.pathname} />
            </nav>
          )}
        </aside>

        <main id="handbook-main" className="min-w-0 flex-1">
          {page ? <HandbookArticle page={page} /> : <MissingPage />}
        </main>

        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-l border-fd-border p-4 xl:block">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-fd-muted-foreground">
            On this page
          </p>
          {page && page.data.toc.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-xs">
              {page.data.toc
                .filter((item) => item.depth <= 3)
                .map((item) => (
                  <li
                    key={`${item.url}-${item.title}`}
                    style={{ paddingLeft: (item.depth - 2) * 10 }}
                  >
                    <a
                      href={item.url}
                      className="block text-fd-muted-foreground hover:text-fd-foreground"
                    >
                      {item.title}
                    </a>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-fd-muted-foreground">No sections on this page.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" fill="none">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function useHandbookSearch(): readonly HandbookSearchEntry[] {
  const [index, setIndex] = useState<readonly HandbookSearchEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/data/handbook-search.json")
      .then((response) => (response.ok ? (response.json() as Promise<HandbookSearchEntry[]>) : []))
      .then((entries) => {
        if (!cancelled) setIndex(entries);
      })
      .catch(() => {
        if (!cancelled) setIndex([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return index;
}

function SearchResults({
  entries,
  onNavigate,
}: {
  entries: readonly HandbookSearchEntry[];
  onNavigate: () => void;
}) {
  if (entries.length === 0) {
    return <p className="p-3 text-xs text-fd-muted-foreground">No matching pages.</p>;
  }
  return (
    <ul className="mt-2 py-1">
      {entries.map((entry) => (
        <li key={entry.url}>
          <Link
            to={entry.url}
            onClick={onNavigate}
            className="block rounded px-2 py-1.5 hover:bg-fd-accent"
          >
            <span className="block truncate text-xs font-medium">{entry.title}</span>
            <span className="block truncate font-mono text-[10px] text-fd-muted-foreground">
              {entry.url}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TreeChildren({
  nodes,
  pathname,
  depth = 0,
}: {
  nodes: readonly Node[];
  pathname: string;
  depth?: number;
}) {
  return (
    <ul
      className={depth === 0 ? "space-y-0.5" : "mt-0.5 space-y-0.5 border-l border-fd-border pl-2"}
    >
      {nodes.map((node, index) => {
        const key = `${node.type}-${index}-${"url" in node ? node.url : (node.name?.toString() ?? "")}`;
        if (node.type === "separator") {
          return (
            <li
              key={key}
              className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-widest text-fd-muted-foreground"
            >
              {node.name}
            </li>
          );
        }
        if (node.type === "folder") {
          return (
            <li key={key}>
              {node.index ? (
                <PageLink item={node.index} pathname={pathname} />
              ) : (
                <span className="block px-2 py-1 text-xs font-semibold">{node.name}</span>
              )}
              {node.children.length > 0 ? (
                <TreeChildren nodes={node.children} pathname={pathname} depth={depth + 1} />
              ) : null}
            </li>
          );
        }
        return (
          <li key={key}>
            <PageLink item={node} pathname={pathname} />
          </li>
        );
      })}
    </ul>
  );
}

function PageLink({ item, pathname }: { item: Extract<Node, { type: "page" }>; pathname: string }) {
  const active = pathname === item.url || pathname === `${item.url}/`;
  return (
    <Link
      to={item.url}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
        active
          ? "bg-fd-accent font-medium text-fd-accent-foreground"
          : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
      }`}
    >
      <ChevronRight className={`size-3 shrink-0 ${active ? "opacity-100" : "opacity-0"}`} />
      <span className="truncate">{item.name}</span>
    </Link>
  );
}

function HandbookArticle({ page }: { page: NonNullable<ReturnType<typeof source.getPage>> }) {
  const Body = page.data.body;
  return (
    <article className="mx-auto max-w-3xl px-6 py-8">
      <header className="space-y-3 border-b border-fd-border pb-6">
        <p className="text-xs uppercase tracking-widest text-fd-muted-foreground">Handbook</p>
        <h1 className="text-3xl font-bold tracking-tight">{page.data.title}</h1>
        {page.data.description ? (
          <p className="text-sm leading-6 text-fd-muted-foreground">{page.data.description}</p>
        ) : null}
        <a
          href={`https://github.com/mr-rogers-neighborhood/suite-apps/blob/main/${sourcePathFor(page.url)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-fd-border px-2.5 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
        >
          <ExternalLink className="size-3.5" />
          Edit on GitHub
        </a>
      </header>
      <div className="handbook-prose mt-6">
        <Body components={mdxComponents} />
      </div>
    </article>
  );
}

function sourcePathFor(url: string): string {
  const slug = url.replace(/^\/handbook\/?/u, "").replace(/\/$/u, "");
  return slug === "" ? "docs/README.md" : `docs/${slug}.md`;
}

function MdxLink({ href = "", children, ...props }: ComponentPropsWithoutRef<"a">) {
  if (href.startsWith("/")) {
    return (
      <Link to={href} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      {...props}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

const mdxComponents = {
  a: MdxLink,
};

function MissingPage(): ReactNode {
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-10">
      <h1 className="text-2xl font-semibold">This handbook page does not exist</h1>
      <p className="text-sm text-fd-muted-foreground">
        Run <code className="rounded bg-fd-muted px-1 py-0.5">pnpm docs:index</code> and{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5">pnpm docs:build</code> to regenerate the
        handbook from <code>docs/</code>.
      </p>
      <Link to="/handbook" className="text-sm underline underline-offset-2">
        Go to the handbook
      </Link>
    </div>
  );
}

export type HandbookTree = Root;
