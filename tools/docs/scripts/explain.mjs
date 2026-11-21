#!/usr/bin/env node
/**
 * Scaffolds one note section for a node.
 *
 * It appends to the owning module MDX and never overwrites an existing section.
 * The generated line is a fact; the TODO is for the person writing the why.
 *
 * Usage: node tools/docs/scripts/explain.mjs <node-id>
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = join(root, "tools/docs/public/data");
const modulesDir = join(root, "docs/modules");
const target = process.argv[2];

if (!target) {
  process.stderr.write("usage: node tools/docs/scripts/explain.mjs <node-id>\n");
  process.exit(1);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const [search, modules] = await Promise.all([
  readJson(join(dataDir, "search.json")),
  readJson(join(dataDir, "modules.json")),
]);

const entry = search.find((candidate) => candidate.id === target);
if (!entry) {
  process.stderr.write(`unknown node: ${target}. Run pnpm docs:index first.\n`);
  process.exit(1);
}
if (entry.kind === "module") {
  process.stderr.write(
    `${target} is a module. Its narrative is the preamble of its module MDX, not a note section.\n`,
  );
  process.exit(1);
}

const module = modules.find((candidate) => candidate.id === entry.moduleId);
if (!module) {
  process.stderr.write(`${target} has no owning module in the index.\n`);
  process.exit(1);
}
const detail = await readJson(join(dataDir, "modules", `${module.slug}.json`));
const file = detail.files.find((candidate) => candidate.id === entry.path);
const symbol = file?.symbols.find((candidate) => candidate.id === entry.id);
const key = entry.kind === "file" ? `file: ${entry.id}` : entry.id;

function moduleIdOf(source) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!frontmatter) return null;
  const line = /^module:\s*(.+?)\s*$/m.exec(frontmatter[1]);
  return line?.[1].replace(/^["']|["']$/g, "") ?? null;
}

async function noteFile() {
  const files = (await readdir(modulesDir).catch(() => [])).filter((name) => name.endsWith(".mdx"));
  for (const name of files) {
    const path = join(modulesDir, name);
    const source = await readFile(path, "utf8");
    if (moduleIdOf(source) === module.id) return { path, source };
  }
  const slug = module.id.replaceAll("/", "__").replaceAll(":", "-");
  return {
    path: join(modulesDir, `${slug}.mdx`),
    source: `---\nmodule: ${module.id}\ntitle: ${module.title}\nsummary: "TODO: one sentence on why this module exists."\n---\n\n`,
  };
}

const note = await noteFile();
const heading = `## ${key}`;
if (note.source.split("\n").some((line) => line.trim() === heading)) {
  process.stderr.write(`${posix.relative(root, note.path)} already has a section for ${key}\n`);
  process.exit(1);
}

const facts = symbol
  ? `\`${symbol.signature}\` in \`${file.id}:${symbol.startLine}\`.`
  : `\`${entry.id}\` (${file?.lineCount ?? 0} lines).`;
const section = [
  heading,
  "",
  "TODO: explain why this exists, the invariant it protects, and the test that guards it.",
  "",
  facts,
  "",
].join("\n");

await mkdir(modulesDir, { recursive: true });
const body = note.source.endsWith("\n") ? note.source : `${note.source}\n`;
await writeFile(note.path, `${body}\n${section}`);
process.stdout.write(`added ${heading} to ${posix.relative(root, note.path)}\n`);
