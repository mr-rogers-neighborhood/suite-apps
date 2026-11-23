/**
 * Rewrites the links in `docs/` Markdown to the routes Suite Help serves.
 *
 * The generated handbook lives under `/handbook`. The old `/docs` URL belonged
 * to the Next app that `apps/help` replaced, so leaving even one of these links
 * as `/docs/...` sends the reader to the not-found page. A link that leaves
 * `docs/` points at a file the app does not render, so it becomes a GitHub URL.
 * Everything else — an external link, a same-page anchor, an absolute path —
 * stays exactly as written.
 */
import { posix } from "node:path";

export const HANDBOOK_BASE = "/handbook";

const GITHUB_BLOB = "https://github.com/mrrnbhd/suite-apps/blob/main/";
const GITHUB_TREE = "https://github.com/mrrnbhd/suite-apps/tree/main/";

/** Split `path#fragment` into the path and the fragment, including its `#`. */
function splitHash(href) {
  const index = href.indexOf("#");
  return index === -1
    ? { path: href, hash: "" }
    : { path: href.slice(0, index), hash: href.slice(index) };
}

/**
 * The handbook URL for a page path relative to `docs/`.
 *
 * `README.md` and `index.md` are the folder's index, so they fold to the folder
 * route: `reference/README.md` and `reference/index.md` both become
 * `/handbook/reference`. This is the same mapping the page tree and the search
 * index use.
 */
export function handbookPathForDocsFile(rel, hash = "") {
  const slug = rel
    .replace(/\.mdx?$/iu, "")
    .replace(/(^|\/)README$/iu, "$1index")
    .replace(/(^|\/)index$/iu, "$1")
    .replace(/\/+$/u, "");
  return `${slug === "" ? HANDBOOK_BASE : `${HANDBOOK_BASE}/${slug}`}${hash}`;
}

/**
 * Rewrite one link target.
 *
 * `rel` is the source page relative to `docs/`; `files` and `dirs` are its
 * published entries. A relative link stays relative-safe because the target is
 * resolved from the page that wrote it, not from the generated folder.
 */
export function rewriteHref(href, rel, files, dirs) {
  if (
    href === "" ||
    href.startsWith("#") ||
    href.startsWith("/") ||
    /^[a-zA-Z][\w+.-]*:/.test(href)
  ) {
    return href;
  }

  const { path, hash } = splitHash(href);
  const resolved = posix.normalize(posix.join(posix.dirname(rel), path));
  const repoPath = posix.normalize(posix.join("docs", resolved));

  // A path that climbs above the repository has no URL to give it.
  if (repoPath === ".." || repoPath.startsWith("../")) return href;

  if (repoPath !== "docs" && !repoPath.startsWith("docs/")) {
    const target = repoPath.replace(/\/+$/u, "");
    const base = path.endsWith("/") ? GITHUB_TREE : GITHUB_BLOB;
    return `${base}${target}${path.endsWith("/") ? "/" : ""}${hash}`;
  }

  const internal = repoPath === "docs" ? "" : repoPath.slice("docs/".length);
  const isDirectory = path.endsWith("/") || internal === "" || dirs.has(internal);

  if (isDirectory) {
    const folder = internal.replace(/\/+$/u, "");
    const prefix = folder === "" ? "" : `${folder}/`;
    if (files.has(`${prefix}README.md`) || files.has(`${prefix}index.md`)) {
      return handbookPathForDocsFile(folder, hash);
    }
    return `${GITHUB_TREE}${folder === "" ? "docs" : `docs/${folder}`}${hash}`;
  }

  if (/\.mdx?$/iu.test(internal)) {
    // No page was generated for this file. `docs-check` reports the broken link;
    // keeping the source text leaves an honest trail rather than inventing a URL.
    if (!files.has(internal)) return href;
    return handbookPathForDocsFile(internal, hash);
  }

  return href;
}

const LINK = /`[^`\n]*`|(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/gu;

/**
 * Rewrite every Markdown link in a prose segment, leaving inline code alone.
 *
 * A code span and a link are matched together so the leftmost one wins: a
 * code span (including one that contains link syntax) is returned untouched, and
 * a link whose label is a code span still has its target rewritten.
 */
function rewriteProse(text, rel, files, dirs) {
  return text.replace(LINK, (match, open, href, close) => {
    if (open === undefined) return match;
    return `${open}${rewriteHref(href, rel, files, dirs)}${close}`;
  });
}

/**
 * Rewrite links outside fenced code blocks.
 *
 * A link label may wrap across lines (`[Packaging\nchannels](…)`), so a segment
 * of prose is rewritten whole rather than line by line. Fenced code and inline
 * code still keep their literal text.
 */
export function rewriteLinks(body, rel, files, dirs) {
  const out = [];
  let prose = [];
  let fenced = false;

  const flush = () => {
    if (prose.length === 0) return;
    out.push(rewriteProse(prose.join("\n"), rel, files, dirs));
    prose = [];
  };

  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) {
      if (!fenced) flush();
      fenced = !fenced;
      out.push(line);
      continue;
    }
    if (fenced) out.push(line);
    else prose.push(line);
  }
  flush();

  return out.join("\n");
}
