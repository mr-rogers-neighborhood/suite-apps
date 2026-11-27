import { useEffect, useMemo, useRef, useState } from "react";
import type { BundledLanguage } from "shiki";

import { observeResolvedTheme, type ResolvedTheme, resolvedTheme } from "@/theme";

type Props = {
  fileId: string;
  source: string;
  startLine: number;
  endLine: number;
  highlight?: boolean;
};

type Token = { content: string; color?: string };
type RenderToken = Token & { key: string };

function languageFor(fileId: string): string {
  const ext = fileId.slice(fileId.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "tsx" || ext === "jsx") return "tsx";
  if (ext === "ts" || ext === "mts" || ext === "cts") return "ts";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "js";
  if (ext === "json" || ext === "jsonc") return "json";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "css") return "css";
  if (ext === "sh") return "bash";
  if (ext === "toml") return "toml";
  return "text";
}

export function CodeView({ fileId, source, startLine, endLine, highlight = true }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLDivElement | null>(null);
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  const [mode, setMode] = useState<ResolvedTheme>(() => resolvedTheme());
  const lines = useMemo(() => source.split("\n"), [source]);
  const tokenLines = useMemo<RenderToken[][] | null>(
    () =>
      tokens?.map((line, lineIndex) =>
        line.map((token, tokenIndex) => ({
          ...token,
          key: `${lineIndex}:${tokenIndex}:${token.content}`,
        })),
      ) ?? null,
    [tokens],
  );

  useEffect(() => {
    setMode(resolvedTheme());
    return observeResolvedTheme(setMode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    const language = languageFor(fileId);
    if (language === "text") return;
    void import("shiki")
      .then(({ codeToTokens }) =>
        codeToTokens(source, {
          lang: language as BundledLanguage,
          theme: mode === "dark" ? "github-dark" : "github-light",
        }),
      )
      .then((result) => {
        if (!cancelled) setTokens(result.tokens as Token[][]);
      })
      .catch(() => {
        // Plain text is a valid fallback; the docs reader must still work.
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, mode, source]);

  useEffect(() => {
    void fileId;
    void startLine;
    void endLine;
    void tokens;
    const line = selected.current;
    const box = container.current;
    if (!line || !box) return;
    const lineBox = line.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    box.scrollTop += lineBox.top - boxRect.top - box.clientHeight / 2 + lineBox.height / 2;
  }, [fileId, startLine, endLine, tokens]);

  return (
    <div
      ref={container}
      className="max-h-[62vh] overflow-auto rounded-xl border border-fd-border bg-fd-muted"
    >
      <div className="min-w-fit py-3 font-mono text-[12px] leading-5 text-fd-foreground">
        {lines.map((line, index) => {
          const number = index + 1;
          const active = highlight && number >= startLine && number <= endLine;
          const lineTokens = tokenLines?.[index];
          return (
            <div
              key={number}
              ref={active && number === startLine ? selected : undefined}
              className={
                active
                  ? "flex border-l-2 border-warning bg-warning/10"
                  : "flex border-l-2 border-transparent"
              }
            >
              <span className="w-12 shrink-0 select-none pr-3 text-right text-fd-muted-foreground">
                {number}
              </span>
              <span className="whitespace-pre pr-6">
                {lineTokens && lineTokens.length > 0
                  ? lineTokens.map((token) => (
                      <span
                        key={token.key}
                        style={token.color ? { color: token.color } : undefined}
                      >
                        {token.content}
                      </span>
                    ))
                  : line === ""
                    ? " "
                    : line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
