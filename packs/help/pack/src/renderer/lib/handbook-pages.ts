import type { Node } from "fumadocs-core/page-tree";

/**
 * One docs tree, two sections.
 *
 * A page chooses its section in `docs/` frontmatter (`audience`), the index writes
 * that choice into `/data/docs.json`, and this module turns it into routes and a
 * filtered page tree. Nothing here keeps a page list of its own: a page that is
 * not in the index is a page the reader will not show.
 */
export type Audience = "user" | "developer";

/** One published page, as `pnpm docs:index` writes it into `/data/docs.json`. */
export type DocsPage = {
  readonly path: string;
  readonly slug: string;
  readonly audience: Audience;
};

/** Where each section opens. The reader's routes and the link rewriter agree here. */
export const SECTION_BASES: Record<Audience, string> = {
  user: "/handbook",
  developer: "/developer",
};

/** The heading each section shows. */
export const SECTION_TITLES: Record<Audience, string> = {
  user: "User handbook",
  developer: "Developer documentation",
};

/** The one-line orientation above a section's entry page. */
export const SECTION_INTROS: Record<Audience, string> = {
  user: "Install Suite, use an app and keep your own data.",
  developer: "The code, the specification and the release machinery.",
};

/** The other section. */
export function otherAudience(audience: Audience): Audience {
  return audience === "user" ? "developer" : "user";
}

/** The route a page opens at inside its section. */
export function sectionUrl(audience: Audience, slug: string): string {
  return slug === "" ? SECTION_BASES[audience] : `${SECTION_BASES[audience]}/${slug}`;
}

/** Every route the section owns, for filtering the page tree and the search index. */
export function urlsForAudience(
  pages: readonly DocsPage[],
  audience: Audience,
): ReadonlySet<string> {
  return new Set(
    pages
      .filter((page) => page.audience === audience)
      .map((page) => sectionUrl(page.audience, page.slug)),
  );
}

/** The section route for a tour's `doc` target (`docs/reference/decisions.md`). */
export function docsPageUrl(pages: readonly DocsPage[], path: string): string | undefined {
  const page = pages.find((candidate) => candidate.path === path);
  return page === undefined ? undefined : sectionUrl(page.audience, page.slug);
}

/**
 * Keep the nodes this section owns, and the folders that still have one.
 *
 * A folder whose index belongs to the other section keeps its children but loses
 * the index, so the folder renders as a label rather than a link. A separator
 * with nothing left under it is dropped.
 */
export function filterPageTree(nodes: readonly Node[], allowed: ReadonlySet<string>): Node[] {
  const kept: Node[] = [];
  let pendingSeparators: Node[] = [];
  for (const node of nodes) {
    if (node.type === "separator") {
      pendingSeparators.push(node);
      continue;
    }
    if (node.type === "page") {
      if (!allowed.has(node.url)) continue;
      kept.push(...pendingSeparators, node);
      pendingSeparators = [];
      continue;
    }
    const children = filterPageTree(node.children, allowed);
    const { index: existingIndex, ...rest } = node;
    const index =
      existingIndex !== undefined && allowed.has(existingIndex.url) ? existingIndex : undefined;
    if (index === undefined && children.length === 0) continue;
    const folder: Node = index === undefined ? { ...rest, children } : { ...rest, index, children };
    kept.push(...pendingSeparators, folder);
    pendingSeparators = [];
  }
  return kept;
}
