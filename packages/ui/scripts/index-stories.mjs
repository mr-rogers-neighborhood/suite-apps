import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { toId } from "storybook/internal/csf";
import { readCsf } from "storybook/internal/csf-tools";

/**
 * Build the workbench catalog from the stories themselves.
 *
 * Storybook already knows every story, but the library page needs the facets before Storybook
 * starts. This is a small static pass over the CSF files: no runtime addon, no hand-maintained
 * list, and `--check` fails the gate if the committed index drifts.
 */
const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const repo = join(app, "..", "..");
const output = join(app, ".storybook", "stories.index.json");

const SKIP = new Set(["node_modules", "dist", "storybook-static", ".git"]);

/** Storybook mounts `.stories.ts` as well as `.stories.tsx`; the catalog has to see both. */
function isStoryFile(path) {
  return /\.stories\.(?:ts|tsx)$/u.test(path);
}

async function filesUnder(root, accept) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (accept(path)) found.push(path);
    }
  }
  await walk(root);
  return found;
}

function uniq(values) {
  return [...new Set(values)];
}

function facet(tags, prefix, fallback) {
  const hit = tags.find((tag) => tag.startsWith(`${prefix}:`));
  return hit ?? fallback;
}

function defaultLayer(title) {
  if (title.startsWith("Workbench/")) return "layer:workbench";
  if (title.startsWith("Packs/")) return "layer:surface";
  return "layer:primitive";
}

async function build() {
  const storyFiles = [
    ...(await filesUnder(join(app, "src"), isStoryFile)),
    ...(await filesUnder(join(app, ".storybook", "workbench"), isStoryFile)),
    // A pack slice is the only pack code the workbench reads. Keep the glob narrow so Canvas's
    // existing story set is not pulled into the single instance by accident.
    ...(await filesUnder(
      join(repo, "packs"),
      (path) => isStoryFile(path) && path.split(/[\\/]/).includes("workbench"),
    )),
  ].sort();

  const stories = [];
  for (const file of storyFiles) {
    const csf = await readCsf(file, { makeTitle: (title) => title });
    csf.parse();
    const title = csf.meta?.title;
    if (typeof title !== "string") continue;

    for (const story of csf.stories) {
      const tags = uniq([...(csf.meta?.tags ?? []), ...(story.tags ?? [])]);
      const facets = {
        pack: facet(tags, "pack", "pack:suite"),
        layer: facet(tags, "layer", defaultLayer(title)),
        status: facet(tags, "status", "status:ready"),
      };
      stories.push({
        id: toId(title, story.name),
        title,
        name: story.name,
        importPath: relative(app, file).split("\\").join("/"),
        module: relative(repo, file).split("\\").join("/"),
        tags: uniq([facets.pack, facets.layer, facets.status, ...tags]),
      });
    }
  }

  stories.sort((left, right) =>
    left.title === right.title
      ? left.name.localeCompare(right.name)
      : left.title.localeCompare(right.title),
  );
  return `${JSON.stringify({ schema: 1, stories }, null, 2)}\n`;
}

const next = await build();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(output, "utf8");
  } catch {
    current = "";
  }
  if (current !== next) {
    console.error("stories.index.json is stale; run `pnpm --filter @suite/ui index:stories`.");
    process.exit(1);
  }
  console.log(`stories.index.json is current (${JSON.parse(next).stories.length} stories).`);
} else {
  await writeFile(output, next);
  console.log(`wrote stories.index.json (${JSON.parse(next).stories.length} stories).`);
}
