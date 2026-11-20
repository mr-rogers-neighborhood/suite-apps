#!/usr/bin/env node
/**
 * Checks the cross-cutting docs for the drift that matters at the root:
 *
 *   1. Relative links and images that point at a file that is not there.
 *   2. A section page that the section index does not list.
 *   3. A retired phrase: the documentation site that does not exist, a duplicated
 *      developer note, and the pre-monorepo sibling workflow.
 *
 * It does not check prose style. Canvas's docs-check owns its own tree; this one
 * owns `docs/` and the root pages, and never rewrites anything.
 *
 * Usage: node scripts/docs-check.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const SECTIONS = ["tutorials", "how-to", "reference", "explanation"];
const ROOT_PAGES = [
  "README.md",
  "AGENTS.md",
  "apps/canvas/README.md",
  "apps/planner/README.md",
  "apps/budget/README.md",
  "apps/start/README.md",
  "apps/sync/README.md",
  "apps/go/README.md",
];
const BANNED = [
  { pattern: /\bdocs:site\b/, why: "the documentation site does not exist" },
  { pattern: /Developer note:/, why: "the origin story has one home in docs/explanation" },
  {
    pattern: /(github\.com\/[^ )]*suite-dev|suite-dev\/scripts|cloned side by side)/,
    why: "the sibling-repository workflow is history; point at the root instead",
  },
];

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

const pages = [
  ...ROOT_PAGES.map((name) => join(root, name)).filter((path) => existsSync(path)),
  ...walk(docs),
];

for (const page of pages) {
  const text = readFileSync(page, "utf8");
  const pageRel = rel(page);

  for (const allowed of BANNED) {
    if (allowed.allow?.some((prefix) => pageRel.startsWith(prefix))) continue;
    for (const match of text.matchAll(new RegExp(allowed.pattern.source, "g"))) {
      const line = text.slice(0, match.index).split("\n").length;
      problems.push(`${pageRel}:${line}: ${allowed.why} (\`${match[0]}\`).`);
    }
  }

  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[1].replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|file:|#)/.test(target)) continue;
    target = decodeURIComponent(target.split("#")[0]);
    if (!target) continue;
    const base = target.startsWith("/") ? root : dirname(page);
    const resolved = resolve(base, target.replace(/^\//, ""));
    if (existsSync(resolved)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    problems.push(`${pageRel}:${line}: missing link target \`${target}\`.`);
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

console.log(`docs-check: ${pages.length} pages, no broken links or retired phrases.`);
