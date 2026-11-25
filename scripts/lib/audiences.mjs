/**
 * The documentation split, defined once.
 *
 * A page under `docs/` says who it is for in its frontmatter:
 *
 *   ---
 *   audience: user
 *   ---
 *
 * `user` is the User Handbook; `developer` is the Developer Documentation. The
 * reader, the link rewriter, the index and the checks all read that key. A page
 * without one is an error, never a fallback: a new page cannot join the tree
 * without choosing a section.
 *
 * The slug mapping lives here too, because the generated index and the Help
 * reader must agree on where a page opens: `README.md` and `index.md` fold to
 * their folder.
 */

/** The two audiences, in the order the navigation shows them. */
export const AUDIENCES = ["user", "developer"];

/** The Help route each section opens at. */
export const SECTION_BASES = { user: "/handbook", developer: "/developer" };

/** Whether a frontmatter value names one of the two audiences. */
export function isAudience(value) {
  return value === "user" || value === "developer";
}

/**
 * Split an optional leading YAML frontmatter block from the body.
 *
 * This reads the block, not the whole YAML document: the docs tree declares a
 * handful of flat keys, and a Markdown page without frontmatter is normal.
 */
export function splitFrontmatter(source) {
  if (!source.startsWith("---\n")) return null;
  const end = source.indexOf("\n---", 3);
  if (end === -1) return null;
  const after = source.indexOf("\n", end + 4);
  return {
    frontmatter: source.slice(4, end),
    body: after === -1 ? "" : source.slice(after + 1),
  };
}

/**
 * The audience a page declares, or the problem that stops it from having one.
 *
 * Returns `{ audience }` or `{ problem }`, never both.
 */
export function readAudience(source) {
  const block = splitFrontmatter(source);
  if (block === null) {
    return {
      problem: "no frontmatter: add `---`, `audience: user` or `audience: developer`, then `---`",
    };
  }
  const match = /^audience\s*:\s*(.+?)\s*$/mu.exec(block.frontmatter);
  if (!match) return { problem: "frontmatter has no `audience` key" };
  const value = match[1].replace(/^["']|["']$/gu, "");
  if (!isAudience(value)) {
    return { problem: `audience must be \`user\` or \`developer\`, not \`${value}\`` };
  }
  return { audience: value };
}

/** `null` when the page chooses a section, the reason otherwise. */
export function audienceProblem(source) {
  const result = readAudience(source);
  return result.audience ? null : result.problem;
}

/**
 * A page path relative to `docs/` as its URL slug.
 *
 * `README.md` and `index.md` are the folder's index, so they fold to the folder
 * route: `reference/README.md` and `reference/index.md` are both `reference`,
 * and the tree root is the empty string.
 */
export function docsSlug(rel) {
  return rel
    .replace(/\.mdx?$/iu, "")
    .replace(/(^|\/)README$/iu, "$1index")
    .replace(/(^|\/)index$/iu, "$1")
    .replace(/\/+$/u, "");
}

/** The URL one page opens at inside its section. */
export function sectionPath(audience, rel, hash = "") {
  const base = SECTION_BASES[audience];
  if (base === undefined) throw new Error(`unknown audience: ${audience}`);
  const slug = docsSlug(rel);
  return `${base}${slug === "" ? "" : `/${slug}`}${hash}`;
}
