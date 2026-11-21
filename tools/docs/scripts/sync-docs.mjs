#!/usr/bin/env node
/**
 * Mirrors `docs/` into `tools/docs/.generated/docs/` for the local reader.
 *
 * The repository's Markdown is plain (`docs/README.md`, no frontmatter), while a
 * Fumadocs page needs a `title`, a `description` and a place in a sidebar. This
 * script is the adapter: it copies the tree, injects the frontmatter the site
 * needs, and rewrites the links a browser cannot resolve.
 *
 *   1. `README.md` becomes `index.mdx`, the folder's index page.
 *   2. A missing `title` comes from the page's `# ` heading, which is then
 *      removed from the body so the page does not render two H1s. A missing
 *      `description` comes from the first prose paragraph.
 *   3. Relative links that leave `docs/` point at GitHub instead, because the
 *      site has no page for them.
 *   4. HTML comments are dropped; they carry no published meaning.
 *   5. `<br>` is the one HTML tag the docs use in prose, and is preserved. Other
 *      `<` and `{}` are escaped because MDX treats them as JSX.
 *
 * The sidebar is generated as `_meta.json` per directory, because that is what
 * Fumadocs reads: the sections in their written order, a section's index page
 * first, and every other page in file order.
 *
 * The output is a pure function of `docs/`: the target is deleted first, entries
 * are walked in sorted order, and nothing is read from the previous run.
 *
 * Usage: node tools/docs/scripts/sync-docs.mjs
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceDir = join(root, "docs");
const contentDir = join(root, "tools/docs/.generated/docs");

const GITHUB_BLOB = "https://github.com/mr-rogers-neighborhood/suite-apps/blob/main/";
const GITHUB_TREE = "https://github.com/mr-rogers-neighborhood/suite-apps/tree/main/";

const DESCRIPTION_LIMIT = 160;

/** Where a page lands under `.generated/docs`. */
function targetPath(rel) {
  return rel.replace(/(^|\/)README\.md$/, "$1index.mdx").replace(/\.md$/, ".mdx");
}

/** True for lines that open a block that is not prose. */
function isNonProse(line) {
  return (
    /^\s*($|#|>|\||-{2,}|\+{2,})/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s/.test(line) ||
    /^\s*!\[/.test(line) ||
    /^\s*<[a-zA-Z/]/.test(line) ||
    /^\s*\[\^/.test(line)
  );
}

/** Strip inline Markdown so the text can go into a `<meta>` description. */
function toPlainText(block) {
  return block
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/`([^`]*)`/g, "$1")
    .replaceAll(/(\*\*|__)(.*?)\1/g, "$2")
    .replaceAll(/(\*|_)(.*?)\1/g, "$2")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** First prose paragraph of the body, shortened to fit a meta description. */
function firstParagraph(body) {
  let block = [];
  let fenced = false;
  const blocks = [];
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line.trim() === "") {
      if (block.length > 0) blocks.push(block.join(" "));
      block = [];
      continue;
    }
    block.push(line);
  }
  if (block.length > 0) blocks.push(block.join(" "));

  for (const candidate of blocks) {
    const lines = candidate.split("\n");
    if (lines.length === 1 && isNonProse(lines[0])) continue;
    if (lines.some(isNonProse)) continue;
    const text = toPlainText(candidate);
    if (text !== "") return truncate(text);
  }
  return undefined;
}

function truncate(text) {
  if (text.length <= DESCRIPTION_LIMIT) return text;
  const cut = text.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace === -1 ? DESCRIPTION_LIMIT : lastSpace).trimEnd()}…`;
}

/** `0002-pnpm-monorepo` -> `Pnpm monorepo`; `index` -> the folder's name. */
function humanize(rel) {
  const withoutExtension = rel.replace(/\.md$/, "");
  const base = posix.basename(withoutExtension);
  const name = base === "index" ? posix.basename(posix.dirname(withoutExtension)) : base;
  const words = name.replace(/^\d+-/, "").replaceAll(/[-_]+/g, " ").trim();
  if (words === "") return "Documentation";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Split leading YAML frontmatter from the body, keeping it verbatim. */
function splitFrontmatter(source) {
  if (!source.startsWith("---\n")) return { frontmatter: null, body: source };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: source };
  const after = source.indexOf("\n", end + 4);
  return {
    frontmatter: source.slice(4, end),
    body: after === -1 ? "" : source.slice(after + 1),
  };
}

/** Quote a value as a YAML double-quoted scalar (JSON strings are valid YAML). */
function yamlString(value) {
  return JSON.stringify(value);
}

/**
 * Makes a page safe to parse as MDX.
 *
 * MDX treats `<` and `{` as JSX: an autolink written as `<https://example.com>`
 * and a brace in prose both fail the build rather than rendering. Autolinks
 * become ordinary Markdown links, `<br>` stays because the docs use it in table
 * cells, and everything else is escaped — outside code fences and inline code,
 * where escaping would change what the code says.
 */
function mdxSafe(body) {
  const BR = "\u0000br\u0000";
  const lines = body.split("\n");
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .split(/(`[^`]*`)/)
        .map((part, index) =>
          index % 2 === 1
            ? part
            : part
                .replace(/<br\s*\/?>/gi, BR)
                .replace(/<((?:https?|mailto):[^>\s]+)>/g, "[$1]($1)")
                .replace(/</g, "\\<")
                .replace(/\{/g, "\\{")
                .replace(/\}/g, "\\}")
                .replaceAll(BR, "<br />"),
        )
        .join("");
    })
    .join("\n");
}

/**
 * Rewrite one link target. Relative links inside `docs/` stay relative (the
 * renderer resolves them against the page's source file), everything else
 * becomes a GitHub URL so the site never points at a 404.
 */
function rewriteHref(href, rel, files, dirs) {
  if (
    href === "" ||
    href.startsWith("#") ||
    href.startsWith("/") ||
    /^[a-zA-Z][\w+.-]*:/.test(href)
  ) {
    return href;
  }
  const hashIndex = href.indexOf("#");
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);

  const baseDir = posix.dirname(rel);
  const resolved = posix.normalize(posix.join(baseDir, path));
  const repoPath = posix.normalize(posix.join("docs", resolved));
  if (repoPath.startsWith("..")) return href;

  if (repoPath !== "docs" && !repoPath.startsWith("docs/")) {
    const url = path.endsWith("/")
      ? `${GITHUB_TREE}${repoPath.replace(/\/$/, "")}/`
      : `${GITHUB_BLOB}${repoPath}`;
    return `${url}${hash}`;
  }

  const internal = repoPath === "docs" ? "" : repoPath.slice("docs/".length);
  const isDirectory = path.endsWith("/") || internal === "" || dirs.has(internal);
  if (isDirectory) {
    const folder = internal.replace(/\/$/, "");
    const prefix = folder === "" ? "" : `${folder}/`;
    if (files.has(`${prefix}README.md`) || files.has(`${prefix}index.md`)) {
      return `${folder === "" ? "/docs/" : `/docs/${folder}/`}${hash}`;
    }
    const target = folder === "" ? "docs" : `docs/${folder}`;
    return `${GITHUB_TREE}${target}${hash}`;
  }

  if (internal.endsWith(".md")) {
    if (!files.has(internal)) return href;
    const slug =
      posix.basename(internal) === "README.md"
        ? posix.dirname(internal)
        : internal.replace(/\.md$/, "").replace(/\/index$/, "");
    return `${slug === "" ? "/docs/" : `/docs/${slug}/`}${hash}`;
  }

  return href;
}

/** Rewrite links outside fenced code blocks (a literal `[x](y)` is not a link). */
function rewriteLinks(body, rel, files, dirs) {
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replaceAll(
        /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
        (_match, open, href, close) => `${open}${rewriteHref(href, rel, files, dirs)}${close}`,
      );
    })
    .join("\n");
}

/** Build the page: frontmatter, then Markdown with a single H1 removed. */
function convertPage(source, rel) {
  const { frontmatter, body: rawBody } = splitFrontmatter(source);
  const body = rawBody.replaceAll(/<!--[\s\S]*?-->/g, "");

  const lines = body.split("\n");
  const firstContent = lines.findIndex((line) => line.trim() !== "");
  const firstHeading =
    firstContent !== -1 && /^# \S/.test(lines[firstContent])
      ? lines[firstContent].slice(2).trim()
      : undefined;
  const declaredTitle = frontmatter
    ?.match(/^title\s*:\s*(.+)$/m)?.[1]
    ?.trim()
    .replaceAll(/^["']|["']$/g, "");
  const stripHeading =
    firstHeading !== undefined && (declaredTitle === undefined || declaredTitle === firstHeading);
  const heading = stripHeading ? firstHeading : undefined;
  const withoutHeading = stripHeading
    ? lines
        .slice(firstContent + 1)
        .join("\n")
        .replace(/^\n+/, "")
    : body;

  const title = heading ?? humanize(rel);
  const description = firstParagraph(withoutHeading) ?? undefined;
  const fields = [`title: ${yamlString(title)}`];
  if (description !== undefined) fields.push(`description: ${yamlString(description)}`);

  if (frontmatter === null) {
    return `---\n${fields.join("\n")}\n---\n\n${mdxSafe(withoutHeading)}`;
  }

  const declared = frontmatter.split("\n");
  const kept = fields.filter((field) => {
    const key = field.slice(0, field.indexOf(":"));
    return !new RegExp(`^${key}\\s*:`, "m").test(frontmatter);
  });
  return `---\n${[...kept, ...declared].join("\n")}\n---\n\n${mdxSafe(withoutHeading)}`;
}

/** Walk `docs/` and return every published entry as a POSIX path relative to it. */
async function walk(dir, prefix = "") {
  const entries = await readdir(join(sourceDir, dir), { withFileTypes: true });
  const files = [];
  const dirs = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      dirs.push(rel);
      const nested = await walk(rel, rel);
      files.push(...nested.files);
      dirs.push(...nested.dirs);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(rel);
    }
  }
  return { files, dirs };
}

/** Copy every non-Markdown file next to the pages. */
async function copyAssets(prefix = "") {
  const entries = await readdir(join(sourceDir, prefix), { withFileTypes: true });
  let copied = 0;
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      copied += await copyAssets(rel);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".md")) continue;
    const destination = join(contentDir, rel);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(sourceDir, rel), destination);
    copied += 1;
  }
  return copied;
}

const { files, dirs } = await walk("");
const fileSet = new Set(files);
const dirSet = new Set(dirs);

await rm(contentDir, { recursive: true, force: true });
await mkdir(contentDir, { recursive: true });

for (const rel of files) {
  const source = await readFile(join(sourceDir, rel), "utf8");
  const page = rewriteLinks(convertPage(source, rel), rel, fileSet, dirSet);
  const target = join(contentDir, targetPath(rel));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, page, "utf8");
}

const SECTION_ORDER = ["tutorials", "how-to", "reference", "explanation"];

function sectionTitle(name) {
  return name === "how-to" ? "How-to" : name.charAt(0).toUpperCase() + name.slice(1);
}

async function writeMeta() {
  const rootPages = ["index", ...SECTION_ORDER.filter((name) => dirSet.has(name))];
  await writeFile(
    join(contentDir, "_meta.json"),
    `${JSON.stringify({ title: "Developer documentation", pages: rootPages }, null, 2)}\n`,
    "utf8",
  );

  for (const dir of dirs) {
    if (!dir) continue;
    const prefix = `${dir}/`;
    const pages = files
      .filter((rel) => rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/"))
      .map((rel) => posix.basename(targetPath(rel)).replace(/\.mdx$/, ""))
      .sort((left, right) => {
        if (left === "index") return -1;
        if (right === "index") return 1;
        return left.localeCompare(right);
      });
    const nested = dirs
      .filter(
        (candidate) =>
          candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"),
      )
      .map((candidate) => posix.basename(candidate));
    if (pages.length === 0 && nested.length === 0) continue;
    await mkdir(join(contentDir, dir), { recursive: true });
    await writeFile(
      join(contentDir, dir, "_meta.json"),
      `${JSON.stringify({ title: sectionTitle(posix.basename(dir)), pages: [...pages, ...nested] }, null, 2)}\n`,
      "utf8",
    );
  }
}

await writeMeta();

const assets = await copyAssets("");

process.stdout.write(
  `synced docs → tools/docs/.generated/docs: ${files.length} pages, ${assets} assets\n`,
);
