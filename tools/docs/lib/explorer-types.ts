export type View = "browser" | "modules" | "walkthroughs";

export type SearchEntry = {
  id: string;
  label: string;
  kind: string;
  moduleId?: string;
  path: string;
  visibility?: string;
};

export type ModuleSummary = {
  id: string;
  title: string;
  kind: string;
  virtual: boolean;
  parentId: string | null;
  slug: string;
  fileCount: number;
  symbolCount: number;
  testCount: number;
  noteCount: number;
  summary: string;
};

export type SymbolSummary = {
  id: string;
  name: string;
  kind: string;
  visibility: string;
};

export type CodeSymbol = SymbolSummary & {
  fileId: string;
  exported: boolean;
  signature: string;
  jsdoc: string;
  startLine: number;
  endLine: number;
  tags: string[];
  note: string;
};

export type ModuleFile = {
  id: string;
  name: string;
  ext: string;
  kind: string;
  moduleId: string;
  lineCount: number;
  source: string;
  symbols: CodeSymbol[];
  note: string;
  tests: string[];
  imports: string[];
  usedBy: number;
};

export type ModuleData = ModuleSummary & {
  note: string;
  files: ModuleFile[];
};

export type WalkStep = {
  node: string;
  note?: string;
};

export type Walk = {
  id: string;
  title: string;
  summary: string;
  start: boolean;
  order: number;
  kind: "path" | "generated";
  generated?: boolean;
  steps: WalkStep[];
};

export type TourTarget =
  | { kind: "module"; id: string }
  | { kind: "file"; id: string }
  | { kind: "symbol"; id: string; level?: "symbol" | "file" }
  | { kind: "walk"; id: string; step?: number }
  | { kind: "doc"; path: string };

export type TourStep = {
  target: TourTarget;
  callout?: string;
};

export type Tour = {
  id: string;
  title: string;
  summary: string;
  order: number;
  start: boolean;
  steps: TourStep[];
};

export type FolderNode = {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  moduleId?: string;
  moduleTitle?: string;
  virtual?: boolean;
};

export type FileTreeNode = {
  type: "file";
  name: string;
  id: string;
  path: string;
  moduleId: string;
  symbols: SymbolSummary[];
};

export type TreeNode = FolderNode | FileTreeNode;

export type BaseData = {
  tree: FolderNode;
  modules: ModuleSummary[];
  search: SearchEntry[];
  walks: Walk[];
  tours: Tour[];
};
