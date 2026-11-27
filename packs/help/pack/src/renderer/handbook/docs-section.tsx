import type { Node } from "fumadocs-core/page-tree";
import { ChevronRight, ExternalLink, GitBranch, Search, X } from "lucide-react";
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import {
  type MenuBarBridge,
  useMenuAction,
  useMenuSlots,
} from "@suite/ui";
import {
  type Audience,
  type DocsPage,
  filterPageTree,
  otherAudience,
  SECTION_BASES,
  SECTION_INTROS,
  SECTION_TITLES,
  urlsForAudience,
} from "@/lib/handbook-pages";
import { filterHandbookSearch, type HandbookSearchEntry } from "@/lib/handbook-search";
import { sources } from "@/lib/source";
import { SectionSwitch } from "@/sections";
import { useHostedMenuBar, useWideViewport } from "../hosted";

const GITHUB_URL = "https://github.com/mrrnbhd/suite-apps";

type HelpSlots = Parameters<MenuBarBridge["setSlots"]>[0] | null;

/**
 * One section of the docs, rendered from the one tree.
 *
 * The route a page opens at comes from its frontmatter audience: `/handbook` for
 * the User Handbook, `/developer` for the Developer Documentation. The generated
 * `/data/docs.json` is the list of pages and their sections, so the sidebar and
 * the search only show the readers of one section their own pages. A link that
 * arrives in the wrong section follows the page to its own one instead of showing
 * a missing page.
 */
export function DocsSection({ audience }: { audience: Audience }) {
  const location = useLocation();
  const navigate = useNavigate();
  const hosted = useHostedMenuBar();
  const wide = useWideViewport();
  const base = SECTION_BASES[audience];
  const source = sources[audience];
  const slugs = location.pathname
    .slice(base.length)
    .split("/")
    .filter((segment) => segment.length > 0);
  const page = source.getPage(slugs);
  const docs = useDocsPages();
  const searchIndex = useHandbookSearch();
  const [query, setQuery] = useState("");
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const allowed = useMemo(
    () => (docs.pages === null ? null : urlsForAudience(docs.pages, audience)),
    [docs.pages, audience],
  );
  const tree = useMemo(
    () => (allowed === null ? [] : filterPageTree(source.getPageTree().children, allowed)),
    [source, allowed],
  );
  const results = useMemo(
    () =>
      filterHandbookSearch(searchIndex, query).filter(
        (entry) => allowed === null || allowed.has(entry.url),
      ),
    [query, searchIndex, allowed],
  );
  const isSectionRoot = slugs.length === 0;
  const belongsHere = page !== undefined && allowed?.has(page.url) === true;

  const pageTitle =
    isSectionRoot
      ? SECTION_TITLES[audience]
      : (page?.data.title ?? SECTION_TITLES[audience]);
  const slots: HelpSlots =
    hosted === null
      ? null
      : {
          format: "suite.menu-slots",
          title: pageTitle,
          navigation: [
            ...(wide
              ? []
              : [
                  {
                    kind: "toggle" as const,
                    id: "help.contents",
                    label: "Contents",
                    pressed: navigatorOpen,
                    glyph: "\u2630",
                    help: {
                      title: "Contents",
                      body: "Shows this section's pages beside the document.",
                    },
                  },
                ]),
            {
              kind: "menu" as const,
              id: "help.sections",
              label: "Help sections",
              items: [
                { id: "help.sections.explorer", label: "Code explorer" },
                { id: "help.sections.tours", label: "Tours" },
                {
                  id: "help.sections.other",
                  label: SECTION_TITLES[otherAudience(audience)],
                  separatorBefore: true,
                },
                {
                  id: "help.sections.github",
                  label: "GitHub",
                  description: "Opens the suite-apps repository.",
                },
              ],
              help: {
                title: "Help sections",
                body: "Moves between the handbook, the tours and the source.",
              },
            },
          ],
          actions: [],
        };
  useMenuSlots(hosted, slots);
  useMenuAction(hosted, (action) => {
    if (action.id === "help.contents") {
      setNavigatorOpen((open) => !open);
      return;
    }
    if (action.id !== "help.sections") return;
    if (action.item === "help.sections.explorer") {
      navigate("/explore");
    } else if (action.item === "help.sections.tours") {
      navigate("/explore?view=tours");
    } else if (action.item === "help.sections.other") {
      navigate(SECTION_BASES[otherAudience(audience)]);
    } else if (action.item === "help.sections.github") {
      window.open(GITHUB_URL, "_blank", "noreferrer");
    }
  });

  useEffect(() => {
    setNavigatorOpen(false);
  }, []);

  // A page from the other section keeps its old link: send the reader to where it
  // lives now, at the same slug.
  if (!isSectionRoot && page !== undefined && allowed !== null && !allowed.has(page.url)) {
    const slug = page.url.slice(base.length);
    return <Navigate to={`${SECTION_BASES[otherAudience(audience)]}${slug}`} replace />;
  }

  return (
    <div className="min-h-dvh bg-fd-background text-fd-foreground">
      <a
        href="#handbook-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-fd-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      {hosted === null ? (
      <header
        data-handbook-region="handbook-header"
        className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b border-fd-border bg-fd-background/95 px-2 backdrop-blur sm:gap-3 sm:px-3"
      >
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
            to="/explore?view=tours"
            className="hidden rounded-lg px-2 py-1.5 hover:bg-fd-accent hover:text-fd-foreground sm:inline-flex"
          >
            Tours
          </Link>
          <SectionSwitch audience={audience} />
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
      </header>
      ) : null}

      <div className={hosted === null ? "flex min-h-[calc(100dvh-3.5rem)] pt-14" : "flex min-h-dvh"}>
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
              ? `fixed ${hosted === null ? "inset-y-14" : "inset-y-0"} left-0 z-40 w-[min(20rem,85vw)] overflow-y-auto border-r border-fd-border bg-fd-background p-3 shadow-xl md:static md:z-auto md:block md:w-72 md:shrink-0 md:shadow-none`
              : `sticky ${hosted === null ? "top-14 h-[calc(100dvh-3.5rem)]" : "top-0 h-dvh"} hidden w-72 shrink-0 overflow-y-auto border-r border-fd-border p-3 md:block`
          }
        >
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-fd-muted-foreground">
            {SECTION_TITLES[audience]}
          </p>
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
              <TreeChildren nodes={tree} pathname={location.pathname} />
            </nav>
          )}
        </aside>

        <main id="handbook-main" className="min-w-0 flex-1 overflow-x-hidden">
          {docs.error !== null ? (
            <DocsError message={docs.error} />
          ) : docs.pages === null ? (
            <p className="p-10 text-sm text-fd-muted-foreground">Loading the handbook…</p>
          ) : belongsHere && page !== undefined ? (
            <DocsArticle page={page} audience={audience} />
          ) : isSectionRoot ? (
            <SectionLanding audience={audience} nodes={tree} />
          ) : (
            <MissingPage audience={audience} />
          )}
        </main>

        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-l border-fd-border p-4 xl:block">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-fd-muted-foreground">
            On this page
          </p>
          {page && allowed?.has(page.url) && page.data.toc.length > 0 ? (
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

/** The generated audience index: which page opens in which section. */
function useDocsPages(): { pages: readonly DocsPage[] | null; error: string | null } {
  const [pages, setPages] = useState<readonly DocsPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/data/docs.json")
      .then((response) => {
        if (!response.ok) throw new Error(`/data/docs.json returned ${response.status}`);
        return response.json() as Promise<{ pages?: DocsPage[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        setPages(body.pages ?? []);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { pages, error };
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

/**
 * The section's entry page, when the docs tree root belongs to the other one.
 *
 * The developer documentation opens on `docs/README.md`; the user handbook has no
 * root page, so it opens on a list of the sections it does have. Nothing here is
 * new prose: every title and description comes from the page tree.
 */
function SectionLanding({ audience, nodes }: { audience: Audience; nodes: readonly Node[] }) {
  const entries: { url: string; name: ReactNode; description?: ReactNode }[] = [];
  for (const node of nodes) {
    if (node.type === "page") {
      entries.push({ url: node.url, name: node.name, description: node.description });
      continue;
    }
    if (node.type !== "folder") continue;
    if (node.index) {
      entries.push({
        url: node.index.url,
        name: node.index.name,
        description: node.index.description,
      });
      continue;
    }
    const first = node.children.find((child) => child.type === "page");
    if (first !== undefined && first.type === "page") {
      entries.push({ url: first.url, name: node.name });
    }
  }

  return (
    <article className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-3 border-b border-fd-border pb-6">
        <p className="text-xs uppercase tracking-widest text-fd-muted-foreground">
          {SECTION_TITLES[audience]}
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{SECTION_TITLES[audience]}</h1>
        <p className="text-sm leading-6 text-fd-muted-foreground">{SECTION_INTROS[audience]}</p>
      </header>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => (
          <li key={entry.url}>
            <Link
              to={entry.url}
              className="block h-full rounded-lg border border-fd-border p-4 hover:bg-fd-accent"
            >
              <span className="text-sm font-semibold">{entry.name}</span>
              {entry.description ? (
                <span className="mt-1 block text-xs leading-5 text-fd-muted-foreground">
                  {entry.description}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

function DocsArticle({
  page,
  audience,
}: {
  page: NonNullable<ReturnType<(typeof sources)[Audience]["getPage"]>>;
  audience: Audience;
}) {
  const Body = page.data.body;
  return (
    <article className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-3 border-b border-fd-border pb-6">
        <p className="text-xs uppercase tracking-widest text-fd-muted-foreground">
          {SECTION_TITLES[audience]}
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{page.data.title}</h1>
        {page.data.description ? (
          <p className="text-sm leading-6 text-fd-muted-foreground">{page.data.description}</p>
        ) : null}
        <a
          href={`https://github.com/mrrnbhd/suite-apps/blob/main/${sourcePathFor(page.path)}`}
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

/** Map a generated page path back to the Markdown file that owns it. */
function sourcePathFor(path: string): string {
  if (path === "index.mdx") return "docs/README.md";
  if (path.endsWith("/index.mdx")) {
    return `docs/${path.replace(/\/index\.mdx$/u, "/README.md")}`;
  }
  return `docs/${path.replace(/\.mdx$/u, ".md")}`;
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

/** A wide table scrolls inside its own frame, so a long row never widens the article. */
function MdxTable({ children, ...props }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="handbook-table">
      <table {...props}>{children}</table>
    </div>
  );
}

const mdxComponents = {
  a: MdxLink,
  table: MdxTable,
};

function DocsError({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4 sm:p-10">
      <h1 className="text-2xl font-semibold">The documentation index could not be loaded</h1>
      <p className="text-sm text-fd-muted-foreground">
        {message}. Run <code className="rounded bg-fd-muted px-1 py-0.5">pnpm docs:index</code> and{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5">pnpm docs:build</code> to regenerate the
        handbook from <code>docs/</code>.
      </p>
    </div>
  );
}

function MissingPage({ audience }: { audience: Audience }) {
  const other = otherAudience(audience);
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4 sm:p-10">
      <h1 className="text-2xl font-semibold">This handbook page does not exist</h1>
      <p className="text-sm text-fd-muted-foreground">
        Run <code className="rounded bg-fd-muted px-1 py-0.5">pnpm docs:index</code> and{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5">pnpm docs:build</code> to regenerate the
        handbook from <code>docs/</code>.
      </p>
      <p className="text-sm">
        <Link to={SECTION_BASES[audience]} className="underline underline-offset-2">
          {SECTION_TITLES[audience]}
        </Link>
        {" · "}
        <Link to={SECTION_BASES[other]} className="underline underline-offset-2">
          {SECTION_TITLES[other]}
        </Link>
      </p>
    </div>
  );
}
