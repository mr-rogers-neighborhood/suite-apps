#!/usr/bin/env node
/**
 * Builds the code index the explorer reads.
 *
 * Every file and declaration becomes a node. Modules are package roots plus the
 * direct children of `src/`, with `docs/modules.json` able to override either.
 * Config files are assigned to synthesized `config:*` modules so they appear in
 * the Modules view without pretending to own product code.
 *
 * Output is data, not prose:
 *   public/data/tree.json
 *   public/data/search.json
 *   public/data/modules.json
 *   public/data/modules/<slug>.json
 *   public/data/tours.json
 *   public/data/tour-membership.json
 *   public/data/docs.json
 *
 * `docs.json` is the audience index: every published page under `docs/` with the
 * section its frontmatter names. The reader filters its page tree by it and the
 * explorer resolves a tour's `doc` target through it, so a page without an
 * audience fails the index rather than landing in a default section.
 *
 * Prose notes come from `docs/modules/`; tours from `docs/tours/`.
 * The generator never overwrites either.
 *
 * Usage: node packs/help/scripts/index-code.mjs
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, posix, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Project, ts } from "ts-morph";
import { parse as parseYaml } from "yaml";
import { docsSlug, isAudience, readAudience } from "../../../scripts/lib/audiences.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = join(root, "packs", "help", "public", "data");
const check = process.argv.includes("--check");
const docsDir = join(root, "docs");
const modulesDir = join(root, "docs/modules");
const toursDir = join(root, "docs/tours");
const modulesConfigPath = join(root, "docs/modules.json");

const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const CONFIG_EXT = new Set([
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".sh",
  ".service",
]);
const INDEX_EXT = new Set([...CODE_EXT, ...CONFIG_EXT]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  "coverage",
  "release",
  ".git",
  ".dev",
  ".turbo",
  ".next",
  ".source",
  ".generated",
  ".vite",
  "storybook-static",
  "playwright-report",
  "test-results",
  "target",
  "public",
]);
const ROOTS = [
  "hosts",
  "legacy",
  "packs",
  "services",
  "packages",
  "scripts",
  "packaging",
  ".github",
];
const ROOT_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "commitlint.config.mjs",
];
const CONFIG_NAME =
  /^(vite|vitest|playwright|electron-builder|eslint|biome|tsconfig|tailwind|postcss|next|stryker|knip|commitlint|flatpak|release|docs-check)/i;

function titleCase(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function packageTitle(name) {
  if (!name) return "Package";
  const short = name.replace(/^@[^/]+\//, "");
  if (short === "ui") return "UI";
  return titleCase(short);
}

async function walk(dir, rel = "") {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await walk(join(dir, entry.name), relPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!INDEX_EXT.has(ext)) continue;
    if (entry.name === "pnpm-lock.yaml" || entry.name === "package-lock.json") continue;
    files.push(relPath);
  }
  return files;
}

async function collectFiles() {
  const files = [];
  for (const dir of ROOTS) {
    try {
      await stat(join(root, dir));
      files.push(...(await walk(dir, dir)));
    } catch {
      // root does not exist
    }
  }
  for (const file of ROOT_FILES) {
    try {
      await stat(join(root, file));
      files.push(file);
    } catch {
      // root file does not exist
    }
  }
  return [...new Set(files)].sort();
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function collectPackages() {
  const found = new Map();
  const skip = new Set([
    "node_modules",
    "dist",
    "out",
    "build",
    ".next",
    ".dev",
    ".generated",
    "coverage",
    "release",
    "src",
    "e2e",
  ]);

  async function visit(base, depth) {
    const entries = await readdir(join(root, base), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      const dir = `${base}/${entry.name}`;
      const pkg = await readJson(join(root, dir, "package.json"));
      if (pkg?.name) {
        found.set(dir, { dir, name: pkg.name, title: packageTitle(pkg.name) });
      }
      if (depth < 3) await visit(dir, depth + 1);
    }
  }

  for (const base of ["hosts", "legacy", "services", "packages", "packs"]) await visit(base, 0);
  return [...found.values()].sort((a, b) => b.dir.length - a.dir.length);
}

function isConfigFile(file) {
  const ext = extname(file).toLowerCase();
  const base = posix.basename(file);
  return CONFIG_EXT.has(ext) || CONFIG_NAME.test(base);
}

/**
 * A pack's `pack/` source lives beside its host app rather than inside it, so map
 * a `packs/<app>/pack/` file back to the app package that owns it. The module
 * index and its notes still describe one app; only the directory changed.
 *
 * A pack can also own workspace packages (`packs/<app>/packages/*`); those keep
 * their own path so the index presents them as the package they are.
 */
function packOwnerPath(file) {
  const match = /^packs\/([^/]+)\/pack\//.exec(file);
  return match === null ? file : `legacy/${match[1]}/${file.slice(`packs/${match[1]}/`.length)}`;
}

function configOwner(file, packages) {
  file = packOwnerPath(file);
  const pkg = packages.find(
    (candidate) => file === candidate.dir || file.startsWith(`${candidate.dir}/`),
  );
  if (pkg) return `config:${pkg.dir}`;
  if (file.startsWith(".github/")) return "config:ci";
  if (file.startsWith("scripts/")) return "config:scripts";
  if (file.startsWith("packaging/")) return "config:packaging";
  return "config:root";
}

function configTitle(id, packages) {
  if (id === "config:root") return "Config: root";
  if (id === "config:ci") return "Config: CI";
  if (id === "config:scripts") return "Config: scripts";
  if (id === "config:packaging") return "Config: packaging";
  const pkg = packages.find((candidate) => id === `config:${candidate.dir}`);
  return pkg ? `Config: ${pkg.title}` : "Config";
}

function moduleFor(file, packages) {
  if (isConfigFile(file)) {
    const owner = configOwner(file, packages);
    return { id: owner, virtual: true };
  }
  file = packOwnerPath(file);
  const pkg = packages.find(
    (candidate) => file === candidate.dir || file.startsWith(`${candidate.dir}/`),
  );
  if (!pkg) {
    return { id: "config:root", virtual: true };
  }
  const relative = file.slice(pkg.dir.length + 1);
  const src = relative.match(/^src\/([^/]+)\//);
  if (src) {
    return { id: `${pkg.dir}/src/${src[1]}`, virtual: false, parentId: pkg.dir, pkg };
  }
  return { id: pkg.dir, virtual: false, pkg };
}

function moduleTitle(id, packages, modulesById) {
  const explicit = modulesById.get(id)?.title;
  if (explicit) return explicit;
  const pkg = packages.find((candidate) => id === candidate.dir);
  if (pkg) return pkg.title;
  const parent = packages.find((candidate) => id.startsWith(`${candidate.dir}/src/`));
  if (parent) {
    const segment = id.slice(`${parent.dir}/src/`.length);
    return `${parent.title} / ${titleCase(segment)}`;
  }
  if (id.startsWith("config:")) return configTitle(id, packages);
  return titleCase(id);
}

function frontmatter(source) {
  if (!source.startsWith("---\n")) return { data: {}, body: source };
  const end = source.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: source };
  const after = source.indexOf("\n", end + 4);
  return {
    data: parseYaml(source.slice(4, end)) ?? {},
    body: after === -1 ? "" : source.slice(after + 1),
  };
}

function sections(body) {
  const lines = body.split("\n");
  const preamble = [];
  const out = [];
  let current;
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) out.push(current);
      current = { heading: match[1].trim(), text: [] };
      continue;
    }
    if (current) current.text.push(line);
    else preamble.push(line);
  }
  if (current) out.push(current);
  return { preamble: preamble.join("\n").trim(), sections: out };
}

function splitOverlay(text) {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => /^###\s+overlay:\s*\S/.test(line));
  if (index === -1) return { body: text.trim(), overlay: undefined };
  const title = /^###\s+overlay:\s*(.+?)\s*$/.exec(lines[index])?.[1] ?? "Note";
  return {
    body: lines.slice(0, index).join("\n").trim(),
    overlay: {
      title,
      body: lines
        .slice(index + 1)
        .join("\n")
        .trim(),
    },
  };
}

async function collectNotes(problems) {
  const moduleNotes = new Map();
  const moduleSummaries = new Map();
  const moduleReviewed = new Map();
  const nodeNotes = new Map();
  const fileNotes = new Map();
  const moduleOwners = new Map();
  const tours = [];

  const moduleFiles = await walkFiles(modulesDir);
  for (const file of moduleFiles) {
    if (!file.endsWith(".mdx")) continue;
    const source = relative(root, file);
    const sourceText = await readFile(file, "utf8");
    const { data, body } = frontmatter(sourceText);
    const declared = readAudience(sourceText);
    if (declared.problem) {
      problems.push({ level: "error", message: `${source}: ${declared.problem}` });
    }
    const moduleId = typeof data.module === "string" ? data.module : undefined;
    if (!moduleId) {
      problems.push({ level: "warning", message: `${source}: frontmatter has no module id` });
      continue;
    }
    if (moduleOwners.has(moduleId)) {
      problems.push({
        level: "warning",
        message: `${source}: module ${moduleId} is already described by ${moduleOwners.get(moduleId)}`,
      });
    } else {
      moduleOwners.set(moduleId, source);
    }
    if (typeof data.summary === "string") moduleSummaries.set(moduleId, data.summary);
    moduleReviewed.set(moduleId, data.reviewed === "human");
    const parsed = sections(body);
    if (parsed.preamble) moduleNotes.set(moduleId, parsed.preamble);
    const seen = new Set();
    for (const section of parsed.sections) {
      const key = section.heading.replaceAll("`", "").trim();
      const text = section.text.join("\n").trim();
      if (!text) continue;
      if (seen.has(key)) {
        problems.push({ level: "warning", message: `${source}: duplicate section for ${key}` });
      }
      seen.add(key);
      if (key.startsWith("file:")) {
        const fileId = key.slice(5).trim();
        if (fileNotes.has(fileId)) {
          problems.push({
            level: "warning",
            message: `${source}: file note for ${fileId} is already in another module MDX`,
          });
        } else {
          fileNotes.set(fileId, text);
        }
      } else {
        if (nodeNotes.has(key)) {
          problems.push({
            level: "warning",
            message: `${source}: node note for ${key} is already in another module MDX`,
          });
        } else {
          nodeNotes.set(key, text);
        }
      }
    }
  }

  const tourEntries = await walkFiles(toursDir);
  const tourIds = new Map();
  for (const file of tourEntries) {
    if (!file.endsWith(".mdx")) continue;
    const source = relative(root, file);
    const sourceText = await readFile(file, "utf8");
    const { data, body } = frontmatter(sourceText);
    const declared = readAudience(sourceText);
    if (declared.problem) {
      problems.push({ level: "error", message: `${source}: ${declared.problem}` });
    }
    const parsed = sections(body);
    const steps = [];
    for (const section of parsed.sections) {
      const heading = section.heading.replaceAll("`", "").trim();
      if (!heading) continue;
      const { body: text, overlay } = splitOverlay(section.text.join("\n"));
      if (/^interlude:/i.test(heading)) {
        const title = heading.replace(/^interlude:\s*/i, "").trim();
        steps.push({
          kind: "interlude",
          title: title || "Interlude",
          body: text,
          ...(overlay ? { overlay } : {}),
        });
        continue;
      }
      steps.push({
        kind: "node",
        target: { kind: "node", id: heading },
        ...(text ? { note: text } : {}),
        ...(overlay ? { overlay } : {}),
      });
    }
    if (steps.length === 0) continue;
    const id = typeof data.id === "string" ? data.id : posix.basename(file, ".mdx");
    if (tourIds.has(id)) {
      problems.push({
        level: "warning",
        message: `${source}: tour id ${id} is already used by ${tourIds.get(id)}`,
      });
    } else {
      tourIds.set(id, source);
    }
    const intro = parsed.preamble.trim();
    if (!intro) {
      problems.push({ level: "warning", message: `${source}: tour has no intro` });
    }
    tours.push({
      id,
      title: typeof data.title === "string" ? data.title : titleCase(posix.basename(file, ".mdx")),
      summary: typeof data.summary === "string" ? data.summary : "",
      intro,
      start: data.start === true,
      order: typeof data.order === "number" ? data.order : 100,
      reviewed: data.reviewed === "human",
      source: "mdx",
      steps,
      file: source,
      ...(declared.audience ? { audience: declared.audience } : {}),
    });
  }

  return { moduleNotes, moduleSummaries, moduleReviewed, nodeNotes, fileNotes, tours };
}

async function walkFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(path)));
    else out.push(path);
  }
  return out.sort();
}

/**
 * Every published handbook page, with the section its frontmatter names.
 *
 * `sync-docs` publishes `.md` only, so only those pages appear here. Modules and
 * tours are explorer prose; `collectNotes` checks their audience in place.
 */
async function collectDocsPages(problems) {
  const pages = [];
  for (const file of await walkFiles(docsDir)) {
    if (!file.endsWith(".md")) continue;
    const path = relative(root, file).split(sep).join("/");
    const result = readAudience(await readFile(file, "utf8"));
    if (result.problem) {
      problems.push({ level: "error", message: `${path}: ${result.problem}` });
      continue;
    }
    pages.push({
      path,
      slug: docsSlug(relative(docsDir, file).split(sep).join("/")),
      audience: result.audience,
    });
  }
  return pages;
}

function targetProblem(target, { nodeIds, moduleIds, tourIds }) {
  if (!target || typeof target !== "object") return "step has no target";
  switch (target.kind) {
    case "node":
      return nodeIds.has(target.id) ? null : `unknown node: ${target.id}`;
    case "module":
      return moduleIds.has(target.id) ? null : `unknown module: ${target.id}`;
    case "file":
      return nodeIds.has(target.id) && !target.id.includes("#")
        ? null
        : `unknown file: ${target.id}`;
    case "symbol": {
      if (!nodeIds.has(target.id) || !target.id.includes("#")) {
        return `unknown symbol: ${target.id}`;
      }
      if (target.level && target.level !== "symbol" && target.level !== "file") {
        return `unknown symbol level: ${target.level}`;
      }
      return null;
    }
    case "tour":
    case "walk":
      return tourIds.has(target.id) ? null : `unknown tour: ${target.id}`;
    case "doc":
      return typeof target.path === "string" && target.path.startsWith("docs/")
        ? null
        : `doc target must be a docs/ path: ${target.path}`;
    default:
      return `unknown target kind: ${target.kind}`;
  }
}

function normalizeOverlay(overlay) {
  if (!overlay || typeof overlay !== "object") return undefined;
  if (typeof overlay.title !== "string" || typeof overlay.body !== "string") return undefined;
  return {
    title: overlay.title,
    body: overlay.body,
    ...(overlay.tone === "warning" ? { tone: "warning" } : {}),
  };
}

async function collectTours(problems, scope) {
  const loaded = [];
  const files = (await walkFiles(toursDir)).filter((file) => file.endsWith(".tour.mjs"));
  for (const file of files) {
    const source = relative(root, file);
    let module;
    try {
      module = await import(pathToFileURL(file).href);
    } catch (reason) {
      problems.push({
        level: "warning",
        message: `${source}: could not load tour: ${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      });
      continue;
    }
    const tour = module.default;
    if (!tour || typeof tour !== "object") {
      problems.push({ level: "warning", message: `${source}: tour has no default export` });
      continue;
    }
    if (!isAudience(tour.audience)) {
      problems.push({
        level: "error",
        message: `${source}: composed tour must declare audience: user | developer`,
      });
    }
    const id = typeof tour.id === "string" ? tour.id : posix.basename(file, ".tour.mjs");
    if (scope.tourIds.has(id)) {
      problems.push({ level: "warning", message: `${source}: tour id ${id} is already used` });
      continue;
    }
    scope.tourIds.add(id);
    if (!Array.isArray(tour.steps) || tour.steps.length === 0) {
      problems.push({ level: "warning", message: `${source}: tour has no steps` });
      continue;
    }
    const steps = [];
    for (const step of tour.steps) {
      if (step?.kind === "interlude") {
        if (typeof step.title !== "string" || typeof step.body !== "string") {
          problems.push({
            level: "warning",
            message: `${source}: interlude needs a title and body`,
          });
          continue;
        }
        const overlay = normalizeOverlay(step.overlay);
        steps.push({
          kind: "interlude",
          title: step.title,
          body: step.body,
          ...(overlay ? { overlay } : {}),
        });
        continue;
      }
      const rawTarget = step?.target ?? step;
      if (!rawTarget || typeof rawTarget !== "object") {
        problems.push({ level: "warning", message: `${source}: step has no target` });
        continue;
      }
      const target = rawTarget.kind === "walk" ? { ...rawTarget, kind: "tour" } : rawTarget;
      const overlay = normalizeOverlay(step.overlay);
      steps.push({
        kind: "node",
        target,
        ...(typeof step.note === "string"
          ? { note: step.note }
          : typeof step.callout === "string"
            ? { note: step.callout }
            : {}),
        ...(overlay ? { overlay } : {}),
      });
    }
    const intro = typeof tour.intro === "string" ? tour.intro.trim() : "";
    if (!intro) problems.push({ level: "warning", message: `${source}: tour has no intro` });
    loaded.push({
      id,
      title: typeof tour.title === "string" ? tour.title : titleCase(id),
      summary: typeof tour.summary === "string" ? tour.summary : "",
      intro,
      order: typeof tour.order === "number" ? tour.order : 100,
      start: tour.start === true,
      reviewed: tour.reviewed === true || tour.reviewed === "human",
      source: "composed",
      steps,
      file: source,
      ...(isAudience(tour.audience) ? { audience: tour.audience } : {}),
    });
  }

  for (const tour of loaded) {
    const valid = [];
    for (const step of tour.steps) {
      if (step.kind !== "node") {
        valid.push(step);
        continue;
      }
      const problem = targetProblem(step.target, scope);
      if (problem) {
        problems.push({ level: "warning", message: `${tour.file}: ${problem}` });
        continue;
      }
      valid.push(step);
    }
    tour.steps = valid;
    if (tour.steps.length === 0) {
      problems.push({ level: "warning", message: `${tour.file}: tour has no valid steps` });
    }
  }

  return loaded;
}

function jsdocFor(node) {
  const docs = node.getJsDocs?.() ?? [];
  return docs
    .map((doc) => doc.getDescription().trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 800);
}

function signatureFor(node) {
  const first = node.getText().split("\n")[0].trim();
  return first.length > 240 ? `${first.slice(0, 237)}...` : first;
}

function tagsFor(name, kind, file) {
  const tags = [];
  if (kind === "function" && /^[A-Z]/.test(name) && file.endsWith(".tsx")) tags.push("component");
  if (/^use[A-Z]/.test(name)) tags.push("hook");
  if (isTestFile(file)) tags.push("test");
  return tags;
}

function isTestFile(file) {
  return /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(file);
}

async function main() {
  const problems = [];
  const [files, packages, notes, docsPages] = await Promise.all([
    collectFiles(),
    collectPackages(),
    collectNotes(problems),
    collectDocsPages(problems),
  ]);
  const config = await readJson(modulesConfigPath);
  const explicitModules = new Map((config?.modules ?? []).map((module) => [module.id, module]));

  // Resolve a module for each file, honouring explicit overrides first.
  const fileModule = new Map();
  for (const file of files) {
    let resolved;
    for (const [pattern, moduleId] of Object.entries(config?.assign ?? {})) {
      if (file === pattern || file.startsWith(`${pattern.replace(/\/$/, "")}/`)) {
        resolved = { id: moduleId, virtual: false };
        break;
      }
    }
    resolved ??= moduleFor(file, packages);
    fileModule.set(file, resolved);
  }

  const moduleMap = new Map();
  function ensureModule(id, options = {}) {
    if (!moduleMap.has(id)) {
      const explicit = explicitModules.get(id);
      moduleMap.set(id, {
        id,
        title: explicit?.title ?? moduleTitle(id, packages, explicitModules),
        kind:
          explicit?.kind ??
          (id.startsWith("config:") ? "config" : id.includes("/src/") ? "submodule" : "package"),
        parentId: explicit?.parentId ?? options.parentId ?? null,
        virtual: explicit?.virtual ?? options.virtual ?? id.startsWith("config:"),
        root: explicit?.root ?? null,
        files: [],
      });
    }
    return moduleMap.get(id);
  }

  for (const resolved of fileModule.values()) {
    const module = ensureModule(resolved.id, resolved);
    if (!module.root && !resolved.virtual) module.root = resolved.id;
  }

  // Explicit modules that own no files still appear in the map.
  for (const [id, module] of explicitModules) {
    ensureModule(id, module);
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: false,
      noEmit: true,
    },
  });

  const codeFiles = files.filter((file) => CODE_EXT.has(extname(file).toLowerCase()));
  for (const file of codeFiles) project.addSourceFileAtPath(join(root, file));

  const fileNodes = new Map();
  const edges = new Map();
  for (const file of files) {
    const module = moduleMap.get(fileModule.get(file).id);
    const sourceFile = project.getSourceFile(join(root, file));
    const text = sourceFile?.getFullText() ?? (await readFile(join(root, file), "utf8"));
    const symbols = [];
    const seen = new Map();
    if (sourceFile) {
      const add = (name, kind, node, extra = {}) => {
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        const id = `${file}#${name}${count > 1 ? `~${count}` : ""}`;
        const exported = extra.exported ?? false;
        const visibility = extra.visibility ?? (exported ? "export" : "internal");
        symbols.push({
          id,
          fileId: file,
          name,
          kind,
          visibility,
          exported,
          signature: extra.signature ?? signatureFor(node),
          jsdoc: extra.jsdoc ?? jsdocFor(node),
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber(),
          tags: tagsFor(name, kind, file),
          note: notes.nodeNotes.get(id) ?? "",
        });
      };

      for (const statement of sourceFile.getStatements()) {
        const exported = statement.isExported?.() ?? false;
        if (statement.isKind(ts.SyntaxKind.FunctionDeclaration)) {
          const name = statement.getName() ?? "default";
          add(name, "function", statement, { exported });
        } else if (statement.isKind(ts.SyntaxKind.ClassDeclaration)) {
          const className = statement.getName() ?? "default";
          add(className, "class", statement, { exported });
          for (const method of statement.getMethods()) {
            const scope = method.getScope();
            add(`${className}.${method.getName()}`, "method", method, {
              exported,
              visibility: scope === "private" ? "private" : exported ? "export" : "internal",
            });
          }
        } else if (statement.isKind(ts.SyntaxKind.InterfaceDeclaration)) {
          add(statement.getName(), "interface", statement, { exported });
        } else if (statement.isKind(ts.SyntaxKind.TypeAliasDeclaration)) {
          add(statement.getName(), "type", statement, { exported });
        } else if (statement.isKind(ts.SyntaxKind.EnumDeclaration)) {
          add(statement.getName(), "enum", statement, { exported });
        } else if (statement.isKind(ts.SyntaxKind.VariableStatement)) {
          for (const declaration of statement.getDeclarations()) {
            const name = declaration.getName();
            if (name.startsWith("{") || name.startsWith("[")) continue;
            const init = declaration.getInitializer();
            const isFunction =
              init?.isKind(ts.SyntaxKind.ArrowFunction) ||
              init?.isKind(ts.SyntaxKind.FunctionExpression);
            add(name, isFunction ? "function" : "const", declaration, {
              exported,
              jsdoc: jsdocFor(statement),
              signature: signatureFor(declaration),
            });
          }
        } else if (statement.isKind(ts.SyntaxKind.ExportAssignment)) {
          add("default", "const", statement, { exported: true, signature: "export default" });
        }
      }
    }

    const node = {
      id: file,
      name: posix.basename(file),
      ext: extname(file).toLowerCase(),
      kind: CODE_EXT.has(extname(file).toLowerCase()) ? "code" : "config",
      moduleId: module.id,
      lineCount: text.split("\n").length,
      source: text,
      symbols,
      note: notes.fileNotes.get(file) ?? "",
      tests: [],
      imports: [],
    };
    fileNodes.set(file, node);
    module.files.push(node);
    edges.set(file, new Set());
  }

  // Resolve relative imports between indexed files.
  const fileSet = new Set(files);
  for (const file of codeFiles) {
    const sourceFile = project.getSourceFile(join(root, file));
    if (!sourceFile) continue;
    const targets = edges.get(file);
    for (const declaration of [
      ...sourceFile.getImportDeclarations(),
      ...sourceFile.getExportDeclarations(),
    ]) {
      const spec = declaration.getModuleSpecifierValue?.();
      if (!spec?.startsWith(".")) continue;
      const base = posix.normalize(posix.join(posix.dirname(file), spec));
      const withoutJs = base.replace(/\.(m|c)?js$/, "");
      const candidates = [
        base,
        ...(withoutJs !== base
          ? [
              `${withoutJs}.ts`,
              `${withoutJs}.tsx`,
              `${withoutJs}.mts`,
              `${withoutJs}.cts`,
              `${withoutJs}.js`,
              `${withoutJs}.jsx`,
            ]
          : []),
        ...[...CODE_EXT].map((ext) => `${base}${ext}`),
        ...[...CODE_EXT].map((ext) => `${base}/index${ext}`),
        `${withoutJs}.json`,
      ];
      const target = candidates.find((candidate) => fileSet.has(candidate));
      if (target) targets.add(target);
    }
  }

  // Test files guard the files they import.
  for (const file of files) {
    if (!isTestFile(file)) continue;
    for (const target of edges.get(file) ?? []) {
      if (!isTestFile(target)) fileNodes.get(target)?.tests.push(file);
    }
  }

  // Reverse import counts for the detail pane.
  const usedBy = new Map();
  for (const targets of edges.values()) {
    for (const target of targets) usedBy.set(target, (usedBy.get(target) ?? 0) + 1);
  }
  for (const file of files) {
    const node = fileNodes.get(file);
    node.imports = [...(edges.get(file) ?? [])].sort();
    node.usedBy = usedBy.get(file) ?? 0;
  }

  // Module summaries and note attachment.
  for (const module of moduleMap.values()) {
    module.summary = notes.moduleSummaries.get(module.id) ?? notes.moduleNotes.get(module.id) ?? "";
    module.reviewed = notes.moduleReviewed.get(module.id) ?? false;
    module.files.sort((left, right) => {
      const testDelta = Number(isTestFile(left.id)) - Number(isTestFile(right.id));
      return testDelta !== 0 ? testDelta : left.id.localeCompare(right.id);
    });
    module.symbolCount = module.files.reduce((sum, file) => sum + file.symbols.length, 0);
    module.testCount = module.files.filter((file) => isTestFile(file.id)).length;
    module.noteCount = module.files.reduce(
      (sum, file) =>
        sum + file.symbols.filter((symbol) => symbol.note).length + (file.note ? 1 : 0),
      0,
    );
    module.fileCount = module.files.length;
    module.slug = module.id.replaceAll("/", "__").replaceAll(":", "-");
  }

  // Written and composed tours plus the generated full descent.
  const MODULE_ORDER = [
    "packages/contracts",
    "packages/files",
    "packages/desktop",
    "packages/theme",
    "packages/ui",
    "hosts/desk",
    "legacy/canvas/packages/graph",
    "legacy/canvas/desktop",
    "legacy/canvas",
    "legacy/planner",
    "legacy/budget",
    "services/relay",
    "hosts/go",
  ];
  const moduleRank = (id) => {
    const index = MODULE_ORDER.findIndex(
      (candidate) => id === candidate || id.startsWith(`${candidate}/`),
    );
    if (index !== -1) return index;
    if (id.startsWith("tools/")) return 100;
    if (id.startsWith("config:")) return 200;
    return 50;
  };
  const modulesSorted = [...moduleMap.values()].sort((left, right) => {
    const delta = moduleRank(left.id) - moduleRank(right.id);
    if (delta !== 0) return delta;
    return left.id.localeCompare(right.id);
  });
  const nodeIds = new Set();
  for (const file of files) {
    nodeIds.add(file);
    for (const symbol of fileNodes.get(file).symbols) nodeIds.add(symbol.id);
  }

  const fullSteps = [];
  for (const module of modulesSorted) {
    for (const file of module.files) {
      fullSteps.push({ kind: "node", target: { kind: "node", id: file.id } });
      const exported = file.symbols.filter((symbol) => symbol.exported);
      const internal = file.symbols.filter((symbol) => !symbol.exported);
      for (const symbol of [...exported, ...internal]) {
        fullSteps.push({ kind: "node", target: { kind: "node", id: symbol.id } });
      }
    }
  }

  if (notes.tours.some((tour) => tour.id === "full-descent")) {
    problems.push({ level: "warning", message: "tour id full-descent is reserved" });
  }
  const writtenTours = notes.tours.sort((left, right) => left.order - right.order);
  const tourIds = new Set([...writtenTours.map((tour) => tour.id), "full-descent"]);
  const composedTours = await collectTours(problems, {
    nodeIds,
    moduleIds: new Set(moduleMap.keys()),
    tourIds,
  });
  const tours = [
    ...writtenTours,
    ...composedTours,
    {
      id: "full-descent",
      title: "Full descent",
      summary: "Every module, file and declaration, in order.",
      intro: "Every module, file and declaration, in order.",
      start: false,
      order: 999,
      source: "generated",
      reviewed: false,
      steps: fullSteps,
    },
  ].sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
  if (!tours.some((tour) => tour.start) && tours.length > 0) tours[0].start = true;

  const membership = {};
  for (const tour of tours) {
    if (tour.source === "generated") continue;
    const seen = new Set();
    tour.steps.forEach((step, index) => {
      if (step.kind !== "node") return;
      const target = step.target;
      if (
        target.kind !== "node" &&
        target.kind !== "module" &&
        target.kind !== "file" &&
        target.kind !== "symbol"
      ) {
        return;
      }
      if (seen.has(target.id)) return;
      seen.add(target.id);
      membership[target.id] ??= [];
      membership[target.id].push({ tourId: tour.id, title: tour.title, step: index });
    });
  }

  const moduleTours = new Map();
  for (const [id, entries] of Object.entries(membership)) {
    const moduleId = moduleMap.has(id) ? id : fileModule.get(id.split("#")[0])?.id;
    if (!moduleId) continue;
    const set = moduleTours.get(moduleId) ?? new Set();
    for (const entry of entries) set.add(entry.tourId);
    moduleTours.set(moduleId, set);
  }
  for (const module of moduleMap.values()) {
    module.tourCount = moduleTours.get(module.id)?.size ?? 0;
  }

  // Unresolved notes and tours are warnings in a normal run; --check fails.
  for (const [id] of notes.moduleNotes) {
    if (!moduleMap.has(id)) {
      problems.push({ level: "warning", message: `note names an unknown module: ${id}` });
    }
  }
  for (const [id] of notes.fileNotes) {
    if (!nodeIds.has(id)) {
      problems.push({ level: "warning", message: `note names an unknown file: ${id}` });
    }
  }
  for (const [id] of notes.nodeNotes) {
    if (!nodeIds.has(id)) {
      problems.push({ level: "warning", message: `note names an unknown node: ${id}` });
    }
  }
  for (const tour of tours) {
    const where = tour.file ?? tour.id;
    if (tour.source !== "generated" && !tour.intro) {
      problems.push({ level: "warning", message: `${where}: tour has no intro` });
    }
    for (const [index, step] of tour.steps.entries()) {
      if (step.kind === "interlude") {
        if (!step.body) {
          problems.push({
            level: "warning",
            message: `${where}: interlude ${index + 1} has no body`,
          });
        }
      } else {
        const problem = targetProblem(step.target, {
          nodeIds,
          moduleIds: new Set(moduleMap.keys()),
          tourIds,
        });
        if (problem) problems.push({ level: "warning", message: `${where}: ${problem}` });
      }
      if (step.overlay) {
        if (!step.overlay.title || !step.overlay.body) {
          problems.push({
            level: "warning",
            message: `${where}: step ${index + 1} has an incomplete overlay`,
          });
        }
      }
    }
  }

  // Tree: the real filesystem, then a synthetic Config root for virtual modules.
  const treeRoot = { name: "suite-apps", type: "folder", path: "", children: [] };
  const folder = (parent, name, path) => {
    let child = parent.children.find((item) => item.type === "folder" && item.name === name);
    if (!child) {
      child = { name, type: "folder", path, children: [] };
      parent.children.push(child);
    }
    return child;
  };
  const moduleRoots = new Map(
    [...moduleMap.values()]
      .filter((module) => !module.virtual)
      .map((module) => [module.root, module]),
  );
  for (const file of files) {
    const entry = fileModule.get(file);
    if (moduleMap.get(entry.id).virtual) continue;
    const parts = file.split("/");
    let parent = treeRoot;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const path = parts.slice(0, index + 1).join("/");
      parent = folder(parent, parts[index], path);
    }
    const node = fileNodes.get(file);
    parent.children.push({
      name: node.name,
      type: "file",
      id: file,
      path: file,
      moduleId: node.moduleId,
      symbols: node.symbols.map((symbol) => ({
        id: symbol.id,
        name: symbol.name,
        kind: symbol.kind,
        visibility: symbol.visibility,
      })),
    });
  }
  for (const module of modulesSorted.filter((candidate) => candidate.virtual)) {
    const configRoot = folder(treeRoot, "config", "config");
    configRoot.virtual = true;
    const moduleNode = folder(configRoot, module.title, module.id);
    moduleNode.virtual = true;
    moduleNode.moduleId = module.id;
    for (const file of module.files) {
      moduleNode.children.push({
        name: file.name,
        type: "file",
        id: file.id,
        path: file.id,
        moduleId: module.id,
        symbols: file.symbols.map((symbol) => ({
          id: symbol.id,
          name: symbol.name,
          kind: symbol.kind,
          visibility: symbol.visibility,
        })),
      });
    }
  }

  function annotate(node) {
    if (node.type === "folder") {
      const module = moduleRoots.get(node.path);
      if (module) {
        node.moduleId = module.id;
        node.moduleTitle = module.title;
      }
      node.children.sort((left, right) => {
        if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
      for (const child of node.children) annotate(child);
    }
  }
  annotate(treeRoot);

  const modules = modulesSorted.map((module) => ({
    id: module.id,
    title: module.title,
    kind: module.kind,
    virtual: module.virtual,
    parentId: module.parentId,
    slug: module.slug,
    fileCount: module.fileCount,
    symbolCount: module.symbolCount,
    testCount: module.testCount,
    noteCount: module.noteCount,
    tourCount: module.tourCount,
    summary: module.summary,
    reviewed: module.reviewed,
  }));

  const search = [];
  for (const module of modules) {
    search.push({
      id: module.id,
      label: module.title,
      kind: "module",
      moduleId: module.id,
      path: module.id,
    });
  }
  for (const file of files) {
    const node = fileNodes.get(file);
    search.push({
      id: file,
      label: node.name,
      kind: "file",
      moduleId: node.moduleId,
      path: file,
    });
    for (const symbol of node.symbols) {
      search.push({
        id: symbol.id,
        label: symbol.name,
        kind: symbol.kind,
        moduleId: node.moduleId,
        path: file,
        visibility: symbol.visibility,
      });
    }
  }
  for (const tour of tours) {
    search.push({
      id: `tour:${tour.id}`,
      label: tour.title,
      kind: "tour",
      moduleId: undefined,
      path: `tour:${tour.id}`,
    });
  }

  const output = new Map();
  for (const module of modulesSorted) {
    output.set(
      `modules/${module.slug}.json`,
      JSON.stringify(
        {
          ...modules.find((candidate) => candidate.id === module.id),
          note: notes.moduleNotes.get(module.id) ?? "",
          files: module.files,
        },
        null,
        0,
      ),
    );
  }
  output.set("tree.json", JSON.stringify(treeRoot));
  output.set("modules.json", JSON.stringify(modules, null, 2));
  output.set("search.json", JSON.stringify(search));
  output.set(
    "tours.json",
    JSON.stringify(
      tours.map((tour) => {
        const copy = { ...tour };
        delete copy.file;
        return copy;
      }),
    ),
  );
  output.set("tour-membership.json", JSON.stringify(membership));
  output.set(
    "docs.json",
    JSON.stringify(
      { version: 1, pages: docsPages.sort((a, b) => a.path.localeCompare(b.path)) },
      null,
      2,
    ),
  );

  if (check) {
    const stale = [];
    for (const [relativePath, content] of output) {
      const existing = await readFile(join(outDir, relativePath), "utf8").catch(() => null);
      if (existing !== content) stale.push(relativePath);
    }
    const expectedModules = new Set(
      [...output.keys()]
        .filter((relativePath) => relativePath.startsWith("modules/"))
        .map((relativePath) => relativePath.slice("modules/".length)),
    );
    const existingModules = await readdir(join(outDir, "modules")).catch(() => []);
    for (const name of existingModules) {
      if (!expectedModules.has(name)) stale.push(`modules/${name}`);
    }
    if (stale.length > 0) {
      const shown = stale.slice(0, 6).join(", ");
      const more = stale.length > 6 ? ` and ${stale.length - 6} more` : "";
      problems.push({
        level: "warning",
        message: `generated index is stale (${shown}${more}); run pnpm docs:index`,
      });
    }
    if (problems.length > 0) {
      for (const problem of problems) process.stderr.write(`error: ${problem.message}\n`);
      process.stderr.write(`index check failed: ${problems.length} problem(s)\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`index is current: ${files.length} files, ${modules.length} modules\n`);
    return;
  }

  for (const problem of problems) process.stderr.write(`warning: ${problem.message}\n`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "modules"), { recursive: true });

  for (const [relativePath, content] of output) {
    const target = join(outDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  process.stdout.write(
    `indexed ${files.length} files, ${search.filter((entry) => entry.kind !== "file" && entry.kind !== "module" && entry.kind !== "tour").length} symbols, ${modules.length} modules, ${tours.length} tours, ${docsPages.length} docs pages\n`,
  );
}

await main();
