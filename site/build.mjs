#!/usr/bin/env node
/**
 * Builds the published Suite site.
 *
 * `site.run` is one hand-written page in `site/src/index.html`. `docs.suite.run`
 * is a renderer over the repository's `docs/` tree: the same files GitHub, the
 * Help pack and `scripts/docs-check.mjs` read. This build is a second renderer,
 * never a second source.
 *
 * The rules the renderer keeps:
 *
 *   1. A page keeps its path: `docs/reference/status.md` becomes
 *      `docs/reference/status.html`, and a `README.md` becomes the folder's
 *      `index.html`.
 *   2. Every relative link is resolved and rewritten. A link between docs pages
 *      stays on the site, a link that leaves `docs/` points at GitHub, and a
 *      missing file or heading fails the build the way `docs-check` does.
 *   3. A page's audience is `audience: user | developer` in frontmatter when it
 *      exists. Until #417 assigns every page, the archive folders fall back to
 *      the handbook and the code-coupled folders to the developer docs.
 *   4. Non-page files under `docs/` are copied, so a linked schema, fixture or
 *      image keeps working.
 *
 * Usage: pnpm site:build
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Marked } from "marked";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
const docsDir = join(root, "docs");
const outDir = join(siteDir, "dist");
const repo = "https://github.com/mrrnbhd/suite-apps";
const repoBlob = `${repo}/blob/main`;
const repoTree = `${repo}/tree/main`;
const defaultBranch = "main";
const docsHost = "https://docs.suite.run";
const styleSource = join(siteDir, "src", "style.css");
const landingSource = join(siteDir, "src", "index.html");
const iconSource = join(docsDir, "assets", "suite-icon.png");
const iconOut = "docs/assets/suite-icon.png";

const problems = [];

/** Paths relative to `docs/` use POSIX separators, as a URL does. */
function toPosix(path) {
  return path.split(sep).join("/");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

/**
 * The slug `scripts/docs-check.mjs` uses for a heading. Sharing the algorithm
 * is what keeps an in-page anchor and the checker's idea of it the same.
 */
function githubSlug(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Split leading YAML frontmatter. Only scalar keys are part of this contract. */
function splitFrontmatter(source) {
  if (!source.startsWith("---\n")) return { data: {}, body: source };
  const end = source.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: source };
  const after = source.indexOf("\n", end + 4);
  const data = {};
  for (const line of source.slice(4, end).split("\n")) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return { data, body: after === -1 ? "" : source.slice(after + 1) };
}

function firstHeading(body) {
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^#\s+(.*)$/.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

function hasTopHeading(body) {
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line.trim() === "") continue;
    return /^#\s+\S/.test(line);
  }
  return false;
}

function humanize(rel) {
  const withoutExtension = rel.replace(/\.mdx?$/, "");
  const base = posix.basename(withoutExtension);
  const name = base === "index" || base === "README" ? posix.basename(posix.dirname(withoutExtension)) : base;
  const words = name.replace(/^\d+-/, "").replaceAll(/[-_]+/g, " ").trim();
  if (words === "") return "Documentation";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The headings a page exposes, with duplicate suffixes, exactly as docs-check does. */
function headingsIn(source) {
  const found = new Set();
  const seen = new Map();
  let fenced = false;
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (!match) continue;
    const base = githubSlug(match[1].replace(/\s+#+\s*$/, ""));
    if (base.length === 0) continue;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    found.add(count === 0 ? base : `${base}-${count}`);
  }
  return found;
}

const headingsCache = new Map();
function headingsFor(abs) {
  const cached = headingsCache.get(abs);
  if (cached !== undefined) return cached;
  const source = readFileSync(abs, "utf8");
  const { body } = splitFrontmatter(source);
  const found = headingsIn(body);
  headingsCache.set(abs, found);
  return found;
}

async function walk(dir, rel = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const pages = [];
  const assets = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(abs, entryRel);
      pages.push(...nested.pages);
      assets.push(...nested.assets);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) pages.push({ rel: entryRel, abs });
    else assets.push({ rel: entryRel, abs });
  }
  return { pages, assets };
}

/** `README.md` is its folder's index; everything else keeps its name with `.html`. */
function pageOut(rel) {
  if (rel === "README.md") return "docs/index.html";
  if (rel.endsWith("/README.md")) return `docs/${rel.slice(0, -"README.md".length)}index.html`;
  if (rel.endsWith("/index.md")) return `docs/${rel.slice(0, -"index.md".length)}index.html`;
  return `docs/${rel.replace(/\.mdx?$/, ".html")}`;
}

/** The audience key #417 will write on every page; the fallback is the archive split. */
function audienceFor(rel, data) {
  if (data.audience !== undefined) {
    if (data.audience !== "user" && data.audience !== "developer") {
      throw new Error(`docs/${rel}: audience must be "user" or "developer", not "${data.audience}".`);
    }
    return data.audience;
  }
  if (rel === "README.md") return null;
  const top = rel.split("/")[0];
  if (top === "tutorials" || top === "how-to" || top === "explanation") return "user";
  return "developer";
}

const SECTION_LABELS = {
  "": "Overview",
  tutorials: "Tutorials",
  "how-to": "How-to",
  explanation: "Explanation",
  reference: "Reference",
  modules: "Modules",
  tours: "Tours",
  spec: "Specification",
};

function sectionLabel(section) {
  return SECTION_LABELS[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
}

function sectionOf(rel) {
  return rel.includes("/") ? rel.split("/")[0] : "";
}

function audienceDir(audience) {
  return audience === "user" ? "handbook" : "developer";
}

function relativeHref(fromOut, toOut, suffix = "") {
  let path = posix.relative(posix.dirname(fromOut), toOut);
  if (path === "") path = posix.basename(toOut);
  return `${path}${suffix}`;
}

function githubUrl(abs, isDirectory, fragment = "") {
  const rel = toPosix(relative(root, abs));
  const base = isDirectory ? repoTree : repoBlob;
  return `${base}/${rel}${fragment ? `#${fragment}` : ""}`;
}

/**
 * Resolve one `href` from a page. Returns the href the browser will use.
 * Throws when the target file or heading is missing, so a broken link fails the
 * build instead of shipping a 404.
 */
function resolveHref(href, page) {
  const raw = href.replace(/^<|>$/g, "");
  if (/^(?:https?:|mailto:|file:|\/\/)/i.test(raw)) return raw;

  const hashIndex = raw.indexOf("#");
  const beforeHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : raw.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf("?");
  const pathPart = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex);

  if (pathPart === "") {
    if (fragment !== "" && !page.headings.has(decodeURIComponent(fragment))) {
      problems.push(`${page.sourceRel}: missing heading anchor \`#${fragment}\`.`);
    }
    return raw;
  }

  const decoded = decodeURIComponent(pathPart);
  const abs = decoded.startsWith("/")
    ? resolve(root, decoded.replace(/^\//, ""))
    : resolve(dirname(page.abs), decoded);

  let info;
  try {
    info = statSync(abs);
  } catch {
    problems.push(`${page.sourceRel}: missing link target \`${pathPart}\`.`);
    return raw;
  }

  if (info.isDirectory()) {
    const readme = join(abs, "README.md");
    const index = join(abs, "index.md");
    let indexAbs = null;
    if (existsSync(readme)) indexAbs = readme;
    else if (existsSync(index)) indexAbs = index;
    if (indexAbs !== null) {
      const rel = toPosix(relative(docsDir, indexAbs));
      if (rel.startsWith("../")) return githubUrl(indexAbs, false, fragment);
      const targetOut = pageOut(rel);
      return relativeHref(page.outRel, targetOut, query + (fragment ? `#${fragment}` : ""));
    }
    const rel = toPosix(relative(docsDir, abs));
    if (!rel.startsWith("../") && rel !== "..") {
      // A docs folder without an index has no HTML page to land on.
      problems.push(`${page.sourceRel}: directory \`${pathPart}\` has no README.md or index.md.`);
      return raw;
    }
    return githubUrl(abs, true, fragment);
  }

  if (/\.mdx?$/.test(abs)) {
    if (fragment !== "") {
      const targets = headingsFor(abs);
      if (!targets.has(decodeURIComponent(fragment))) {
        problems.push(
          `${page.sourceRel}: missing heading anchor \`#${fragment}\` in ${toPosix(relative(root, abs))}.`,
        );
      }
    }
    const rel = toPosix(relative(docsDir, abs));
    if (rel.startsWith("../")) return githubUrl(abs, false, fragment);
    return relativeHref(page.outRel, pageOut(rel), query + (fragment ? `#${fragment}` : ""));
  }

  const rel = toPosix(relative(docsDir, abs));
  if (rel.startsWith("../")) return githubUrl(abs, false, fragment);
  return relativeHref(page.outRel, `docs/${rel}`, query + (fragment ? `#${fragment}` : ""));
}

function renderPage(page) {
  const seen = new Map();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = decodeEntities(inner.replace(/<[^>]*>/g, ""));
        const base = githubSlug(text);
        if (base.length === 0) return `<h${depth}>${inner}</h${depth}>`;
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        return `<h${depth} id="${escapeAttr(id)}">${inner}</h${depth}>`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        let target;
        try {
          target = resolveHref(href, page);
        } catch (error) {
          problems.push(`${page.sourceRel}: ${error.message}`);
          target = href;
        }
        const titleAttr = title === null || title === undefined ? "" : ` title="${escapeAttr(title)}"`;
        return `<a href="${escapeAttr(target)}"${titleAttr}>${text}</a>`;
      },
      image({ href, title, text }) {
        let target;
        try {
          target = resolveHref(href, page);
        } catch (error) {
          problems.push(`${page.sourceRel}: ${error.message}`);
          target = href;
        }
        const titleAttr = title === null || title === undefined ? "" : ` title="${escapeAttr(title)}"`;
        return `<img src="${escapeAttr(target)}" alt="${escapeAttr(text)}"${titleAttr}>`;
      },
    },
  });

  return marked.parse(page.body);
}

function headerHtml(page, audience) {
  const home = relativeHref(page.outRel, "docs/index.html");
  const handbook = relativeHref(page.outRel, "docs/handbook/index.html");
  const developer = relativeHref(page.outRel, "docs/developer/index.html");
  const userCurrent = audience === "user" ? ' aria-current="page"' : "";
  const developerCurrent = audience === "developer" ? ' aria-current="page"' : "";
  const icon = relativeHref(page.outRel, iconOut);
  return `<header class="site-header docs-header">
  <a class="brand" href="https://suite.run/">
    <img src="${escapeAttr(icon)}" alt="" width="32" height="32">
    <span>Suite</span>
  </a>
  <nav class="switch" aria-label="Documentation section">
    <a href="${escapeAttr(handbook)}"${userCurrent}>User Handbook</a>
    <a href="${escapeAttr(developer)}"${developerCurrent}>Developer Documentation</a>
  </nav>
  <nav class="site-nav" aria-label="Suite">
    <a href="${escapeAttr(home)}">Docs home</a>
    <a href="https://github.com/mrrnbhd/suite-apps">GitHub</a>
  </nav>
</header>`;
}

function footerHtml(page) {
  const icon = relativeHref(page.outRel, iconOut);
  return `<footer class="site-footer">
  <p><img src="${escapeAttr(icon)}" alt="" width="20" height="20"> Suite is local-first, MIT licensed.</p>
  <nav aria-label="Elsewhere">
    <a href="https://suite.run/">suite.run</a>
    <a href="https://docs.suite.run/">docs.suite.run</a>
    <a href="https://github.com/mrrnbhd/suite-apps">GitHub</a>
  </nav>
</footer>`;
}

function sidebarHtml(page, audience) {
  const links = [];
  const homeHref = relativeHref(page.outRel, "docs/index.html");
  links.push(
    `<a class="sidebar-home" href="${escapeAttr(homeHref)}"${page.outRel === "docs/index.html" ? ' aria-current="page"' : ""}>Documentation</a>`,
  );

  if (audience === null) {
    const handbook = relativeHref(page.outRel, "docs/handbook/index.html");
    const developer = relativeHref(page.outRel, "docs/developer/index.html");
    links.push(`<div class="sidebar-group"><p class="sidebar-title">Sections</p>
      <a href="${escapeAttr(handbook)}">User Handbook</a>
      <a href="${escapeAttr(developer)}">Developer Documentation</a>
    </div>`);
    return `<aside class="sidebar" aria-label="Documentation">${links.join("\n")}</aside>`;
  }

  const pages = [...page.index.values()]
    .filter((candidate) => candidate.audience === audience)
    .sort((a, b) => {
      const sectionA = sectionOf(a.sourceRel);
      const sectionB = sectionOf(b.sourceRel);
      if (sectionA !== sectionB) return sectionA.localeCompare(sectionB);
      const aIndex = a.sourceRel.endsWith("/README.md") || a.sourceRel.endsWith("/index.md");
      const bIndex = b.sourceRel.endsWith("/README.md") || b.sourceRel.endsWith("/index.md");
      if (aIndex !== bIndex) return aIndex ? -1 : 1;
      return a.outRel.localeCompare(b.outRel);
    });

  let currentSection = null;
  const groups = [];
  for (const candidate of pages) {
    const section = sectionOf(candidate.sourceRel);
    if (section !== currentSection) {
      if (currentSection !== null) groups.push("</div>");
      groups.push(`<div class="sidebar-group"><p class="sidebar-title">${escapeHtml(sectionLabel(section))}</p>`);
      currentSection = section;
    }
    const href = relativeHref(page.outRel, candidate.outRel);
    const current = candidate.outRel === page.outRel ? ' aria-current="page"' : "";
    groups.push(`<a href="${escapeAttr(href)}"${current}>${escapeHtml(candidate.title)}</a>`);
  }
  if (currentSection !== null) groups.push("</div>");
  links.push(...groups);
  return `<aside class="sidebar" aria-label="Documentation">${links.join("\n")}</aside>`;
}

function pageDocument(page, bodyHtml, audience) {
  const style = relativeHref(page.outRel, "style.css");
  const icon = relativeHref(page.outRel, iconOut);
  const description = page.summary ?? page.title;
  const title =
    page.outRel === "docs/index.html"
      ? "Suite documentation"
      : `${page.title} — Suite documentation`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="icon" href="${escapeAttr(icon)}">
  <link rel="stylesheet" href="${escapeAttr(style)}">
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
${headerHtml(page, audience)}
<div class="docs-shell">
${sidebarHtml(page, audience)}
<main id="content" class="prose">
${bodyHtml}
</main>
</div>
${footerHtml(page)}
</body>
</html>
`;
}

function audienceIndexDocument(audience, pageIndex) {
  const title = audience === "user" ? "User Handbook" : "Developer Documentation";
  const page = {
    outRel: `docs/${audienceDir(audience)}/index.html`,
    sourceRel: audience === "user" ? "handbook" : "developer",
    title,
    summary: `The pages in docs/ assigned to the ${title.toLowerCase()}.`,
    audience,
    headings: new Set(),
    index: pageIndex,
  };
  const pages = [...pageIndex.values()]
    .filter((candidate) => candidate.audience === audience)
    .sort((a, b) => {
      const sectionA = sectionOf(a.sourceRel);
      const sectionB = sectionOf(b.sourceRel);
      if (sectionA !== sectionB) return sectionA.localeCompare(sectionB);
      return a.outRel.localeCompare(b.outRel);
    });
  const groups = new Map();
  for (const candidate of pages) {
    const section = sectionOf(candidate.sourceRel);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(candidate);
  }
  const sections = [...groups.entries()]
    .map(([section, entries]) => {
      const items = entries
        .map((candidate) => {
          const href = relativeHref(page.outRel, candidate.outRel);
          const summary = candidate.summary
            ? `<span class="page-summary">${escapeHtml(candidate.summary)}</span>`
            : "";
          return `<li><a href="${escapeAttr(href)}">${escapeHtml(candidate.title)}</a>${summary}</li>`;
        })
        .join("\n");
      return `<section class="index-section"><h2>${escapeHtml(sectionLabel(section))}</h2><ul class="page-list">${items}</ul></section>`;
    })
    .join("\n");
  const body = `<h1>${escapeHtml(title)}</h1>
<p class="lede">One of the two sections over the same <code>docs/</code> tree. A page joins it with
<code>audience: ${audience}</code> in frontmatter.</p>
${sections}`;
  return pageDocument(page, body, audience);
}

function docsHomePage(pageIndex) {
  const readme = pageIndex.get("README.md");
  const page = {
    ...readme,
    outRel: "docs/index.html",
    sourceRel: "README.md",
    audience: null,
    index: pageIndex,
  };
  return page;
}

async function buildDocs() {
  const { pages: sourcePages, assets } = await walk(docsDir);
  const pageIndex = new Map();
  const parsed = [];

  for (const source of sourcePages) {
    const text = await readFile(source.abs, "utf8");
    const { data, body } = splitFrontmatter(text);
    const heading = firstHeading(body);
    const title = data.title ?? heading ?? humanize(source.rel);
    const audience = audienceFor(source.rel, data);
    const summary = data.summary ?? data.description ?? undefined;
    const entry = {
      rel: source.rel,
      sourceRel: source.rel,
      abs: source.abs,
      body,
      outRel: pageOut(source.rel),
      title,
      summary,
      audience,
      headings: headingsIn(body),
    };
    parsed.push(entry);
    pageIndex.set(source.rel, entry);
  }

  // A section that #417 has not labelled yet still needs a stable home.
  for (const entry of parsed) entry.index = pageIndex;

  await mkdir(join(outDir, "docs"), { recursive: true });
  for (const asset of assets) {
    const target = join(outDir, "docs", asset.rel);
    await mkdir(dirname(target), { recursive: true });
    await cp(asset.abs, target);
  }

  for (const entry of parsed) {
    const page = { ...entry, index: pageIndex };
    const body = hasTopHeading(entry.body) ? entry.body : `# ${entry.title}\n\n${entry.body}`;
    if (!hasTopHeading(entry.body)) page.headings.add(githubSlug(entry.title));
    const html = renderPage({ ...page, body });
    await mkdir(dirname(join(outDir, page.outRel)), { recursive: true });
    await writeFile(join(outDir, page.outRel), pageDocument(page, html, entry.audience), "utf8");
  }

  // The docs home is the repository's docs/README.md, not a second summary.
  const home = docsHomePage(pageIndex);
  const homeBody = home.body;
  const homeHtml = renderPage({ ...home, body: homeBody });
  await writeFile(join(outDir, "docs/index.html"), pageDocument(home, homeHtml, null), "utf8");

  for (const audience of ["user", "developer"]) {
    const out = join(outDir, "docs", audienceDir(audience), "index.html");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, audienceIndexDocument(audience, pageIndex), "utf8");
  }

  return { count: parsed.length };
}

async function buildSite() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  try {
    await stat(iconSource);
  } catch {
    throw new Error("docs/assets/suite-icon.png is missing; it is the canonical brand mark.");
  }

  await cp(styleSource, join(outDir, "style.css"));
  await cp(landingSource, join(outDir, "index.html"));

  const docs = await buildDocs();

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    throw new Error(`${problems.length} site link problem(s).`);
  }

  console.log(`site: landing page, ${docs.count} docs pages, links and anchors resolved.`);
}

buildSite().catch((error) => {
  console.error(`site: ${error.message}`);
  process.exitCode = 1;
});
