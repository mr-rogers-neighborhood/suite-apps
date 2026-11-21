#!/usr/bin/env node
/**
 * Reports how much of the code index has authored prose.
 *
 * Report only: this never fails on a gap. Run `pnpm docs:index` first so the
 * data matches the tree.
 *
 * Usage: node tools/docs/scripts/coverage.mjs [--json]
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = join(root, "tools/docs/public/data");
const asJson = process.argv.includes("--json");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function percent(part, total) {
  if (total === 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

const [modules, search, walks] = await Promise.all([
  readJson(join(dataDir, "modules.json")),
  readJson(join(dataDir, "search.json")),
  readJson(join(dataDir, "walks.json")),
]);

const fileEntries = search.filter((entry) => entry.kind === "file");
const symbolEntries = search.filter(
  (entry) => entry.kind !== "file" && entry.kind !== "module" && entry.kind !== "walk",
);
const exportedSymbols = symbolEntries.filter((entry) => entry.visibility === "export");

const moduleDetails = await Promise.all(
  modules.map(async (module) => {
    const detail = await readJson(join(dataDir, "modules", `${module.slug}.json`)).catch(
      () => null,
    );
    const files = detail?.files ?? [];
    const symbols = files.flatMap((file) => file.symbols);
    const notedFiles = files.filter(
      (file) => file.note || file.symbols.some((symbol) => symbol.note),
    ).length;
    const notedSymbols = symbols.filter((symbol) => symbol.note).length;
    const exported = symbols.filter((symbol) => symbol.exported).length;
    return {
      id: module.id,
      title: module.title,
      narrative: Boolean(module.summary?.trim()),
      files: files.length,
      notedFiles,
      symbols: symbols.length,
      exported,
      notedSymbols,
      score: (module.summary?.trim() ? 1 : 0) * 3 + notedFiles,
    };
  }),
);

const modulesWithNarrative = moduleDetails.filter((module) => module.narrative).length;
const modulesWithNotes = moduleDetails.filter(
  (module) => module.notedFiles > 0 || module.notedSymbols > 0,
).length;
const notedFiles = moduleDetails.reduce((sum, module) => sum + module.notedFiles, 0);
const notedSymbols = moduleDetails.reduce((sum, module) => sum + module.notedSymbols, 0);
const authoredSymbols = symbolEntries.length;
const authoredExported = exportedSymbols.length;
const authoredWalks = walks.filter((walk) => !walk.generated);
const generatedWalk = walks.find((walk) => walk.generated);
const walkSteps = authoredWalks.flatMap((walk) => walk.steps ?? []);
const walkStepsWithNotes = walkSteps.filter((step) => step.note).length;

const gaps = moduleDetails
  .filter((module) => !module.narrative && module.notedFiles === 0 && module.notedSymbols === 0)
  .sort((left, right) => right.symbols - left.symbols)
  .slice(0, 12);

const report = {
  modules: {
    total: moduleDetails.length,
    withNarrative: modulesWithNarrative,
    withNotes: modulesWithNotes,
  },
  files: { total: fileEntries.length, withNotes: notedFiles },
  symbols: {
    total: authoredSymbols,
    exported: authoredExported,
    withNotes: notedSymbols,
  },
  walks: {
    total: walks.length,
    steps: walkSteps.length,
    stepsWithNotes: walkStepsWithNotes,
    generatedSteps: generatedWalk?.steps?.length ?? 0,
  },
  gaps,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `${[
      "docs coverage (report only)",
      `modules  ${modulesWithNarrative}/${moduleDetails.length} narrative, ${modulesWithNotes}/${moduleDetails.length} any note`,
      `files    ${notedFiles}/${fileEntries.length} with a note (${percent(notedFiles, fileEntries.length)})`,
      `symbols  ${notedSymbols}/${authoredSymbols} with a note (${percent(notedSymbols, authoredSymbols)})`,
      `walks    ${walkStepsWithNotes}/${walkSteps.length} authored steps with a note; ${generatedWalk?.steps?.length ?? 0} generated`,
      "",
      "largest modules with no authored prose:",
      ...(gaps.length === 0
        ? ["  none"]
        : gaps.map(
            (module) => `  ${module.id} — ${module.symbols} symbols, ${module.files} files`,
          )),
    ].join("\n")}\n`,
  );
}
