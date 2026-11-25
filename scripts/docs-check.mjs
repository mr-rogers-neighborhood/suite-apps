#!/usr/bin/env node
/**
 * Checks the documentation for the drift that matters:
 *
 *   1. Relative links and images that point at a file that is not there.
 *   2. Relative links that point at a heading that is not there.
 *   3. Inline code that names a repository path, when the file is not there.
 *   4. Install links to the repositories the monorepo replaced.
 *   5. A section page that the section index does not list.
 *   6. A retired phrase: the documentation site that does not exist, a duplicated
 *      developer note, the pre-monorepo sibling workflow, and facts this pass fixed.
 *
 * It does not check prose style. It walks `docs/`, every app's `docs/`, and the
 * root pages, and never rewrites anything.
 *
 * Usage: node scripts/docs-check.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const SECTIONS = ["tutorials", "how-to", "reference", "explanation"];
const APPS = [
  "legacy/canvas",
  "legacy/planner",
  "legacy/budget",
  "services/relay",
  "hosts/go",
];
const ROOT_PAGES = [
  "README.md",
  "AGENTS.md",
  "RELEASES.md",
  ...APPS.map((app) => `${app}/README.md`),
];
const BANNED = [
  {
    pattern: /\bdocs:site\b/,
    why: "the hosted documentation site is gone; use docs:dev for the local reader",
  },
  { pattern: /Developer note:/, why: "the origin story has one home in docs/explanation" },
  {
    pattern: /(github\.com\/[^ )]*suite-dev|suite-dev\/scripts|cloned side by side)/,
    why: "the sibling-repository workflow is history; point at the root instead",
  },
  {
    pattern: /no published remote/i,
    why: "the signed suite-dev remote is published; Packaging channels owns it",
  },
  { pattern: /\bSeventeen methods\b/, why: "Budget's bridge has nineteen methods" },
  { pattern: /\bis a promise in all three\b/, why: "Canvas's platform is a property" },
  { pattern: /\bNeither app has peers or a sync pill\b/i, why: "Planner renders a SyncPill" },
  {
    pattern: /\bPlanner and Budget (?:have no sync transport|do not sync)\b/i,
    why: "Planner syncs; only Budget has no network client",
  },
  {
    pattern: /changes its data folder/i,
    why: "every pre-release tier keeps the one Suite Slop folder",
  },
  {
    pattern: /SUITE_START_CATALOG|SUITE_START_VERSION/,
    why: "the hub reads its catalogue and feed base; these variables were retired",
  },
];
/** Repositories the monorepo replaced. A line that calls one archived is allowed. */
const REPLACED_REPO =
  /https?:\/\/github\.com\/mr-rogers-neighborhood\/suite-(?:start|canvas|planner|budget|go)(?=[/\s)>"']|$)/gi;
/** Inline code is checked only when it looks like a path from a known repository root. */
const REPO_PATH = /^(?:[\w.@+-]+\/)+[\w.@+.-]+\.[A-Za-z0-9]{1,8}$/;
const REPO_PATH_ROOTS = /^(docs|packages|scripts|packaging|hosts|legacy|packs|services)\//;

const problems = [];

function rel(path) {
  return relative(root, path).split(sep).join("/");
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

/** The app a page belongs to, for paths written relative to that app's root. */
function appRoot(path) {
  const match = /^(?:.*\/)?((?:hosts|legacy|services)\/[^/]+)\//.exec(rel(path));
  return match ? join(root, match[1]) : null;
}

/** The headings a page exposes as anchors, in GitHub's slug form. */
const headingCaches = new Map();
function headings(path) {
  const cached = headingCaches.get(path);
  if (cached !== undefined) return cached;

  const found = new Set();
  const seen = new Map();
  let fenced = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
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
  headingCaches.set(path, found);
  return found;
}

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

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

const pages = [
  ...ROOT_PAGES.map((name) => join(root, name)).filter((path) => existsSync(path)),
  ...walk(docs),
  ...APPS.flatMap((app) => walk(join(root, app, "docs"))),
];

for (const page of pages) {
  const text = readFileSync(page, "utf8");
  const pageRel = rel(page);

  for (const retired of BANNED) {
    const flags = retired.pattern.flags.includes("g")
      ? retired.pattern.flags
      : `${retired.pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(retired.pattern.source, flags))) {
      problems.push(`${pageRel}:${lineAt(text, match.index)}: ${retired.why} (\`${match[0]}\`).`);
    }
  }

  for (const match of text.matchAll(REPLACED_REPO)) {
    const line = lineAt(text, match.index);
    const lineText = text.split("\n")[line - 1] ?? "";
    if (/\b(archived|legacy|history)\b/i.test(lineText)) continue;
    problems.push(
      `${pageRel}:${line}: install link points at a replaced repository (\`${match[0]}\`).`,
    );
  }

  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[1].replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|file:)/.test(target)) continue;
    const line = lineAt(text, match.index);
    const [rawPath, ...fragmentParts] = target.split("#");
    const fragment = fragmentParts.join("#");
    if (rawPath.length === 0) {
      if (fragment.length > 0 && !headings(page).has(decodeURIComponent(fragment))) {
        problems.push(`${pageRel}:${line}: missing heading anchor \`#${fragment}\`.`);
      }
      continue;
    }
    const base = rawPath.startsWith("/") ? root : dirname(page);
    const resolved = resolve(base, decodeURIComponent(rawPath.replace(/^\//, "")));
    if (!existsSync(resolved)) {
      problems.push(`${pageRel}:${line}: missing link target \`${rawPath}\`.`);
      continue;
    }
    if (
      fragment.length > 0 &&
      statSync(resolved).isFile() &&
      resolved.endsWith(".md") &&
      !headings(resolved).has(decodeURIComponent(fragment))
    ) {
      problems.push(
        `${pageRel}:${line}: missing heading anchor \`#${fragment}\` in ${rel(resolved)}.`,
      );
    }
  }

  const pathRoots = [root, appRoot(page)].filter((candidate) => candidate !== null);
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim();
    if (!token.includes("/") || !REPO_PATH.test(token) || !REPO_PATH_ROOTS.test(token)) continue;
    if (pathRoots.some((base) => existsSync(resolve(base, token)))) continue;
    problems.push(
      `${pageRel}:${lineAt(text, match.index)}: inline path does not exist \`${token}\`.`,
    );
  }
}

const docsIndex = readFileSync(join(docs, "README.md"), "utf8");
for (const section of SECTIONS) {
  const indexPath = join(docs, section, "index.md");
  if (!existsSync(indexPath)) {
    problems.push(`docs/${section}/index.md: missing section index.`);
    continue;
  }
  if (!docsIndex.includes(`${section}/index.md`)) {
    problems.push(`docs/README.md: does not link ${section}/index.md.`);
  }
  const index = readFileSync(indexPath, "utf8");
  const entries = readdirSync(join(docs, section), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "index.md") continue;
    if (!index.includes(`(${entry.name})`)) {
      problems.push(`docs/${section}/index.md: does not list ${entry.name}.`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} documentation problem(s).`);
  process.exit(1);
}

console.log(
  `docs-check: ${pages.length} pages, no broken links, anchors, paths or retired phrases.`,
);
