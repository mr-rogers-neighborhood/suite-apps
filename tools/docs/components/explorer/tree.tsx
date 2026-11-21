"use client";

import {
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
  Route,
} from "lucide-react";
import type { FolderNode, TreeNode } from "@/lib/explorer-types";

type Props = {
  tree: FolderNode;
  selectedId: string | null;
  expanded: Set<string>;
  internalOpen: Set<string>;
  tourNodes: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (path: string) => void;
  onToggleInternal: (fileId: string) => void;
};

type Common = Omit<Props, "tree">;

function iconFor(node: TreeNode): LucideIcon {
  return node.type === "file" &&
    (node.name.endsWith(".json") || node.name.endsWith(".yaml") || node.name.endsWith(".yml"))
    ? FileText
    : FileCode2;
}

function kindBadge(kind: string) {
  if (kind === "function") return "fn";
  if (kind === "class") return "cls";
  if (kind === "method") return "m";
  if (kind === "interface") return "if";
  if (kind === "type") return "ty";
  if (kind === "enum") return "en";
  if (kind === "const") return "c";
  return "•";
}

export function BrowserTree({
  tree,
  selectedId,
  expanded,
  internalOpen,
  tourNodes,
  onSelect,
  onToggle,
  onToggleInternal,
}: Props) {
  return (
    <div className="py-1 text-[13px]">
      <FolderRows
        node={tree}
        depth={0}
        selectedId={selectedId}
        expanded={expanded}
        internalOpen={internalOpen}
        tourNodes={tourNodes}
        onSelect={onSelect}
        onToggle={onToggle}
        onToggleInternal={onToggleInternal}
      />
    </div>
  );
}

function FolderRows({
  node,
  depth,
  selectedId,
  expanded,
  internalOpen,
  tourNodes,
  onSelect,
  onToggle,
  onToggleInternal,
}: Common & { node: TreeNode; depth: number; tourNodes: Set<string> }) {
  if (node.type === "file") {
    const open = expanded.has(node.id);
    const exported = node.symbols.filter(
      (symbol) => symbol.visibility === "export" || symbol.visibility === "public",
    );
    const internal = node.symbols.filter(
      (symbol) => symbol.visibility !== "export" && symbol.visibility !== "public",
    );
    const showInternal = internalOpen.has(node.id);
    const Icon = iconFor(node);
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            onSelect(node.id);
            if (node.symbols.length > 0) onToggle(node.id);
          }}
          className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-fd-accent ${
            selectedId === node.id ? "bg-fd-accent text-fd-accent-foreground" : ""
          }`}
          style={{ paddingLeft: depth * 12 + 8 }}
          aria-expanded={node.symbols.length > 0 ? open : undefined}
        >
          {node.symbols.length > 0 ? (
            <ChevronRight
              className={`size-3.5 shrink-0 text-fd-muted-foreground transition-transform ${
                open ? "rotate-90" : ""
              }`}
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <Icon className="size-3.5 shrink-0 text-fd-muted-foreground" />
          <span className="truncate">{node.name}</span>
          {tourNodes.has(node.id) ? (
            <Route className="size-3 shrink-0 text-fd-primary/70" aria-label="In a tour" />
          ) : null}
        </button>

        {open && node.symbols.length > 0 ? (
          <div>
            {exported.map((symbol) => (
              <button
                key={symbol.id}
                type="button"
                onClick={() => onSelect(symbol.id)}
                className={`flex w-full items-center gap-2 py-0.5 pr-2 text-left text-[12px] hover:bg-fd-accent ${
                  selectedId === symbol.id ? "bg-fd-accent text-fd-accent-foreground" : ""
                }`}
                style={{ paddingLeft: depth * 12 + 34 }}
              >
                <span className="w-5 shrink-0 rounded bg-fd-muted text-center text-[10px] text-fd-muted-foreground">
                  {kindBadge(symbol.kind)}
                </span>
                <span className="truncate">{symbol.name}</span>
                {tourNodes.has(symbol.id) ? (
                  <Route className="size-3 shrink-0 text-fd-primary/70" aria-label="In a tour" />
                ) : null}
              </button>
            ))}
            {internal.length > 0 ? (
              <button
                type="button"
                onClick={() => onToggleInternal(node.id)}
                className="py-0.5 pr-2 text-[11px] text-fd-muted-foreground hover:text-fd-foreground"
                style={{ paddingLeft: depth * 12 + 34 }}
              >
                {showInternal ? "Hide internal" : `${internal.length} internal`}
              </button>
            ) : null}
            {showInternal
              ? internal.map((symbol) => (
                  <button
                    key={symbol.id}
                    type="button"
                    onClick={() => onSelect(symbol.id)}
                    className={`flex w-full items-center gap-2 py-0.5 pr-2 text-left text-[12px] text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground ${
                      selectedId === symbol.id ? "bg-fd-accent text-fd-accent-foreground" : ""
                    }`}
                    style={{ paddingLeft: depth * 12 + 34 }}
                  >
                    <span className="w-5 shrink-0 rounded bg-fd-muted text-center text-[10px]">
                      {kindBadge(symbol.kind)}
                    </span>
                    <span className="truncate">{symbol.name}</span>
                    {tourNodes.has(symbol.id) ? (
                      <Route
                        className="size-3 shrink-0 text-fd-primary/70"
                        aria-label="In a tour"
                      />
                    ) : null}
                  </button>
                ))
              : null}
          </div>
        ) : null}
      </div>
    );
  }

  const open = expanded.has(node.path);
  const Icon = open ? FolderOpen : Folder;
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className="flex w-full items-center gap-1.5 py-1 pr-2 text-left font-medium hover:bg-fd-accent"
        style={{ paddingLeft: depth * 12 + 8 }}
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-fd-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <Icon className="size-3.5 shrink-0 text-fd-muted-foreground" />
        <span className="truncate">{node.name}</span>
        {node.virtual ? (
          <span className="ml-1 rounded border border-dashed border-fd-border px-1 text-[9px] uppercase tracking-wide text-fd-muted-foreground">
            virtual
          </span>
        ) : null}
        {node.moduleId ? (
          <span
            title={node.moduleTitle}
            className="ml-auto size-1.5 shrink-0 rounded-full bg-fd-primary/70"
          />
        ) : null}
      </button>
      {open
        ? node.children.map((child) => (
            <FolderRows
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              internalOpen={internalOpen}
              tourNodes={tourNodes}
              onSelect={onSelect}
              onToggle={onToggle}
              onToggleInternal={onToggleInternal}
            />
          ))
        : null}
    </div>
  );
}
