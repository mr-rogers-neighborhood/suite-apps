import type { JSONContent } from "@tiptap/react";

/**
 * Turn a legacy plain-text note into the initial rich document.
 *
 * The old surface was a textarea, so its newlines were hard breaks, not paragraph separators.
 * Keeping them as `hardBreak` nodes is what makes an untouched note render as it did before.
 */
export function plainTextToContent(text: string): JSONContent {
  const inline: JSONContent[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (index > 0) inline.push({ type: "hardBreak" });
    if (line.length > 0) inline.push({ type: "text", text: line });
  }
  return {
    type: "doc",
    content: [{ type: "paragraph", ...(inline.length === 0 ? {} : { content: inline }) }],
  };
}
