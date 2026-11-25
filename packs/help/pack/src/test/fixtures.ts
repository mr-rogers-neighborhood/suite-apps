import type {
  BaseData,
  FolderNode,
  ModuleData,
  ModuleSummary,
  SearchEntry,
  Tour,
  TourMembership,
} from "@/lib/explorer-types";

/**
 * One tiny index in the shape `pnpm docs:index` writes.
 *
 * The pack tests mount the real explorer over this fixture rather than over the repository's
 * generated files: the point is that the pack's own data files are enough to open Browser,
 * Modules and Tours, and a fixture keeps that proof stable as the repository grows.
 */
export const FILE_ID = "legacy/help/src/example.ts";
export const MODULE_ID = "legacy/help";
export const SYMBOL_ID = `${FILE_ID}#start`;

const moduleSummary: ModuleSummary = {
  id: MODULE_ID,
  title: "Help",
  kind: "app",
  virtual: false,
  parentId: null,
  slug: "legacy-help",
  fileCount: 1,
  symbolCount: 1,
  testCount: 0,
  noteCount: 0,
  summary: "The documentation reader.",
  tourCount: 1,
  reviewed: false,
};

export const baseData: BaseData = {
  tree: {
    type: "folder",
    name: "",
    path: "",
    children: [
      {
        type: "folder",
        name: "legacy",
        path: "legacy",
        children: [
          {
            type: "folder",
            name: "help",
            path: "legacy/help",
            moduleId: MODULE_ID,
            moduleTitle: "Help",
            children: [
              {
                type: "file",
                name: "example.ts",
                id: FILE_ID,
                path: FILE_ID,
                moduleId: MODULE_ID,
                symbols: [
                  {
                    id: SYMBOL_ID,
                    name: "start",
                    kind: "function",
                    visibility: "export",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } satisfies FolderNode,
  modules: [moduleSummary],
  search: [
    {
      id: FILE_ID,
      label: "example.ts",
      kind: "file",
      moduleId: MODULE_ID,
      path: FILE_ID,
    },
    {
      id: SYMBOL_ID,
      label: "start",
      kind: "function",
      moduleId: MODULE_ID,
      path: FILE_ID,
      visibility: "export",
    },
    {
      id: `module:${MODULE_ID}`,
      label: "Help",
      kind: "module",
      moduleId: MODULE_ID,
      path: MODULE_ID,
    },
  ] satisfies SearchEntry[],
  tours: [
    {
      id: "start",
      title: "Start here",
      summary: "The shortest path through the fixture.",
      intro: "A tour needs nothing but the bundled index.",
      order: 0,
      start: true,
      reviewed: false,
      source: "mdx",
      steps: [
        { kind: "node", target: { kind: "node", id: FILE_ID }, note: "The first file." },
        { kind: "interlude", title: "A chapter", body: "The tour can pause." },
      ],
    },
  ] satisfies Tour[],
  membership: {
    [FILE_ID]: [{ tourId: "start", title: "Start here", step: 0 }],
  } satisfies TourMembership,
};

export const moduleData: ModuleData = {
  ...moduleSummary,
  note: "The explorer is the structure.",
  files: [
    {
      id: FILE_ID,
      name: "example.ts",
      ext: ".ts",
      kind: "source",
      moduleId: MODULE_ID,
      lineCount: 3,
      source: 'export function start(): string {\n  return "Help";\n}\n',
      symbols: [
        {
          id: SYMBOL_ID,
          name: "start",
          kind: "function",
          visibility: "export",
          fileId: FILE_ID,
          exported: true,
          signature: "start(): string",
          jsdoc: "",
          startLine: 1,
          endLine: 1,
          tags: [],
          note: "",
        },
      ],
      note: "",
      tests: [],
      imports: [],
      usedBy: 0,
    },
  ],
};

/** The JSON files the explorer and the handbook search read, keyed by the URL they fetch. */
export const responses: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["/data/tree.json", baseData.tree],
  ["/data/modules.json", baseData.modules],
  ["/data/search.json", baseData.search],
  ["/data/tours.json", baseData.tours],
  ["/data/tour-membership.json", baseData.membership],
  ["/data/handbook-search.json", []],
  [`/data/modules/${moduleSummary.slug}.json`, moduleData],
]);
