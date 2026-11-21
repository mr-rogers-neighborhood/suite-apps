import { type ContainerID, type LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";

import { noteKey } from "./constants";

/**
 * The plain-text view of a note.
 *
 * An old note lives in the legacy text container, which is what an older build still reads. Once
 * the rich editor has written the note map, the map is the truth and the legacy text is only a
 * fallback. Reading the map back as lines is what keeps `getNote` useful to a caller that only
 * wants the words.
 */
export function getNote(doc: LoroDoc, taskId: string): string {
  const rich = doc.getMap(noteKey(taskId));
  if (typeof rich.get("nodeName") === "string") return noteDocText(rich);
  return doc.getText(noteKey(taskId)).toString();
}

const noteBlockNames = new Set(["doc", "bulletList", "orderedList", "listItem"]);

/** Flatten the editor's node map back to the words, one line per block. */
function noteDocText(node: LoroMap | LoroText): string {
  if (node instanceof LoroText) return node.toString();
  if (node.get("nodeName") === "hardBreak") return "\n";
  const children = node.get("children");
  if (!(children instanceof LoroList)) return "";
  const separator = noteBlockNames.has(String(node.get("nodeName"))) ? "\n" : "";
  return children
    .toArray()
    .map((child) =>
      child instanceof LoroMap || child instanceof LoroText ? noteDocText(child) : "",
    )
    .join(separator);
}

/**
 * Seed the legacy plain-text container.
 *
 * The rich editor writes the note map, not this text; keeping the seed in one place lets a caller
 * create an old-shaped note (and lets the migration path be exercised) without a second writer.
 */
export function setNote(doc: LoroDoc, taskId: string, value: string): string {
  const text = doc.getText(noteKey(taskId));
  replaceText(text, value);
  doc.commit();
  return value;
}

export function getNoteText(doc: LoroDoc, taskId: string): LoroText {
  return doc.getText(noteKey(taskId));
}

/**
 * The rich note root the editor binds to.
 *
 * Loro keeps the text and map roots apart by container type, so this map can share the
 * `note:<taskId>` key with the legacy text above. The editor owns this map; nothing else writes it.
 */
export function getNoteDoc(doc: LoroDoc, taskId: string): LoroMap {
  return doc.getMap(noteKey(taskId));
}

export function getNoteContainerId(doc: LoroDoc, taskId: string): ContainerID {
  return getNoteDoc(doc, taskId).id;
}

function replaceText(text: LoroText, value: string): void {
  const current = text.toString();
  if (current === value) return;
  if (current.length > 0) text.delete(0, current.length);
  if (value.length > 0) text.insert(0, value);
}
