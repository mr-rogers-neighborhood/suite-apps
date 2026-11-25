#!/usr/bin/env node
/**
 * Reports how much of the code index has prose, and how much of that prose a
 * person has reviewed. Generated notes are never counted as authored.
 *
 * Report only: this never fails on a gap. Run `pnpm docs:index` first so the
 * data matches the tree.
 *
 * Usage: node legacy/help/scripts/coverage.mjs [--json]
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = join(root, "legacy", "help", "public", "data");
const asJson = process.argv.includes("--json");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function percent(part, total) {
  if (total === 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

const [modules, search, tours] = await Promise.all([
  readJson(join(dataDir, "modules.json")),
  readJson(join(dataDir, "search.json")),
  readJson(join(dataDir, "tours.json")),
]);

const fileEntries = search.filter((entry) => entry.kind === "file");
const symbolEntries = search.filter(
  (entry) => entry.kind !== "file" && entry.kind !== "module" && entry.kind !== "tour",
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
      reviewed: Boolean(module.reviewed),
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
const modulesReviewed = moduleDetails.filter((module) => module.reviewed).length;
const modulesWithNotes = moduleDetails.filter(
  (module) => module.notedFiles > 0 || module.notedSymbols > 0,
).length;
const notedFiles = moduleDetails.reduce((sum, module) => sum + module.notedFiles, 0);
const notedSymbols = moduleDetails.reduce((sum, module) => sum + module.notedSymbols, 0);
const indexedSymbols = symbolEntries.length;
const indexedExported = exportedSymbols.length;
const writtenTours = tours.filter((tour) => tour.source !== "generated");
const reviewedTours = writtenTours.filter((tour) => tour.reviewed);
const generatedTour = tours.find((tour) => tour.source === "generated");
const steps = writtenTours.flatMap((tour) => tour.steps ?? []);
const nodeSteps = steps.filter((step) => step.kind === "node");
const noteSteps = nodeSteps.filter((step) => step.note);
const interludes = steps.filter((step) => step.kind === "interlude");
const toursWithIntro = writtenTours.filter((tour) => tour.intro?.trim()).length;

const gaps = moduleDetails
  .filter((module) => !module.narrative && module.notedFiles === 0 && module.notedSymbols === 0)
  .sort((left, right) => right.symbols - left.symbols)
  .slice(0, 12);

const report = {
  modules: {
    total: moduleDetails.length,
    reviewed: modulesReviewed,
    withProse: modulesWithNarrative,
    withNotes: modulesWithNotes,
  },
  files: { total: fileEntries.length, withNotes: notedFiles },
  symbols: {
    total: indexedSymbols,
    exported: indexedExported,
    withNotes: notedSymbols,
  },
  tours: {
    total: tours.length,
    reviewed: reviewedTours.length,
    written: writtenTours.length,
    withIntro: toursWithIntro,
    steps: nodeSteps.length,
    stepsWithNotes: noteSteps.length,
    interludes: interludes.length,
    generatedSteps: generatedTour?.steps?.length ?? 0,
  },
  gaps,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `${[
      'docs coverage (report only; "authored" means a person read or rewrote it)',
      `modules  ${modulesReviewed}/${moduleDetails.length} human-authored; ${modulesWithNarrative}/${moduleDetails.length} with generated prose`,
      `files    ${notedFiles}/${fileEntries.length} with a note (${percent(notedFiles, fileEntries.length)})`,
      `symbols  ${notedSymbols}/${indexedSymbols} with a note (${percent(notedSymbols, indexedSymbols)})`,
      `tours    ${reviewedTours.length}/${writtenTours.length} human-authored; ${noteSteps.length}/${nodeSteps.length} generated notes; ${interludes.length} interludes; ${generatedTour?.steps?.length ?? 0} generated steps`,
      "",
      "largest modules with no prose yet:",
      ...(gaps.length === 0
        ? ["  none"]
        : gaps.map(
            (module) => `  ${module.id} — ${module.symbols} symbols, ${module.files} files`,
          )),
    ].join("\n")}\n`,
  );
}
