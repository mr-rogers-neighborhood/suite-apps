export type View = "browser" | "modules" | "tours";

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
  tourCount: number;
  reviewed: boolean;
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

export type TourTarget =
  | { kind: "node"; id: string }
  | { kind: "module"; id: string }
  | { kind: "file"; id: string }
  | { kind: "symbol"; id: string; level?: "symbol" | "file" }
  | { kind: "tour"; id: string; step?: number }
  | { kind: "doc"; path: string };

export type TourOverlay = {
  title: string;
  body: string;
  tone?: "note" | "warning";
};

export type TourNodeStep = {
  kind: "node";
  target: TourTarget;
  note?: string;
  overlay?: TourOverlay;
};

export type TourInterlude = {
  kind: "interlude";
  title: string;
  body: string;
  overlay?: TourOverlay;
};

export type TourStep = TourNodeStep | TourInterlude;

export type TourSource = "mdx" | "composed" | "generated";

export type Tour = {
  id: string;
  title: string;
  summary: string;
  intro: string;
  order: number;
  start: boolean;
  reviewed: boolean;
  source: TourSource;
  steps: TourStep[];
};

export type TourMembershipEntry = {
  tourId: string;
  title: string;
  step: number;
};

export type TourMembership = Record<string, TourMembershipEntry[]>;

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
  tours: Tour[];
  membership: TourMembership;
};
