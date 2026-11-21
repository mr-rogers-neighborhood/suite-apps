import type { WorkspaceDocument } from "@suite/planner-core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useId, useMemo } from "react";

import { LoroNoteSync, type LoroNoteSyncOptions } from "./LoroNoteSync";
import { plainTextToContent } from "./notesEditor";
import { TaskNotesToolbar } from "./TaskNotesToolbar";

type TaskNotesEditorProps = {
  /** The replica's document; the editor binds to its `note:<taskId>` root. */
  readonly workspace: WorkspaceDocument;
  readonly taskId: string;
  /** The legacy plain-text note, used only when the rich container has no content yet. */
  readonly initialText: string;
  readonly label?: string;
};

/**
 * The rich note editor: a Tiptap view over the task's Loro container.
 *
 * There is no value/onChange pair. The ProseMirror plugin writes each transaction into the
 * replica's Loro document, and the replica's single `observe` subscription forwards that update
 * to the main process. An old plain-text note becomes the initial document; once the rich root
 * exists, the plugin loads it and this initial text is ignored.
 */
export function TaskNotesEditor({
  workspace,
  taskId,
  initialText,
  label = "Notes",
}: TaskNotesEditorProps) {
  const labelId = useId();
  const editorId = useId();
  const descriptionId = useId();

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        },
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      LoroNoteSync.configure({
        doc: workspace.loro as unknown as NonNullable<LoroNoteSyncOptions["doc"]>,
        containerId: workspace.getNoteContainerId(taskId),
        commitOrigin: `note:${taskId}`,
      }),
    ],
    [workspace, taskId],
  );

  const editor = useEditor(
    {
      extensions,
      content: plainTextToContent(initialText),
      editorProps: {
        attributes: {
          id: editorId,
          "aria-labelledby": labelId,
          "aria-describedby": descriptionId,
          "aria-multiline": "true",
          role: "textbox",
          spellcheck: "true",
          class:
            "tiptap min-h-24 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px] leading-relaxed text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 [&_a]:text-[var(--accent)] [&_a]:underline [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mb-1 [&_h1]:mt-3 [&_h1]:text-[16px] [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
        },
      },
    },
    [extensions],
  );

  return (
    <section aria-labelledby={labelId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          id={labelId}
          htmlFor={editorId}
          className="text-[12px] font-medium text-[var(--ink)]"
        >
          {label}
        </label>
        <TaskNotesToolbar editor={editor} />
      </div>
      <div className="mt-1.5">
        <EditorContent editor={editor} />
      </div>
      <p id={descriptionId} className="mt-1 text-[11px] text-muted">
        Rich text. Changes are saved as you type.
      </p>
    </section>
  );
}
