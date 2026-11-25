import { cx, FOCUS_RING } from "@suite/ui";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Bold, Code, Italic, Link as LinkIcon, List, ListOrdered } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const HEADING_LEVELS = [1, 2, 3] as const;

type TaskNotesToolbarProps = {
  readonly editor: Editor | null;
};

type ActiveNoteFormat = {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  readonly link: boolean;
  readonly bulletList: boolean;
  readonly orderedList: boolean;
  readonly heading: number;
  readonly paragraph: boolean;
};

function buttonClass(active: boolean): string {
  return cx(
    FOCUS_RING,
    "inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-[12px] leading-none",
    active
      ? "bg-[var(--ink)] text-[var(--surface)]"
      : "text-muted hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
  );
}

/**
 * The formatting controls for a task note.
 *
 * Every control is a toggle over the selection or a block conversion, except Link, which opens
 * a small row because a URL has to be typed somewhere. Controls keep the editor's selection by
 * preventing the pointer's default focus move; the editor regains focus in the command chain.
 */
export function TaskNotesToolbar({ editor }: TaskNotesToolbarProps) {
  const linkId = useId();
  const linkInput = useRef<HTMLInputElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");

  const active = useEditorState({
    editor,
    selector: ({ editor: current }): ActiveNoteFormat | null =>
      current === null
        ? null
        : {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            code: current.isActive("code"),
            link: current.isActive("link"),
            bulletList: current.isActive("bulletList"),
            orderedList: current.isActive("orderedList"),
            heading: current.isActive("heading")
              ? Number(current.getAttributes("heading").level)
              : 0,
            paragraph: current.isActive("paragraph"),
          },
  });

  useEffect(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);

  function run(command: (chain: ReturnType<Editor["chain"]>) => void): void {
    if (!editor) return;
    command(editor.chain().focus());
  }

  function openLink(): void {
    if (!editor) return;
    setLinkDraft(editor.getAttributes("link").href ?? "");
    setLinkOpen(true);
  }

  function applyLink(): void {
    if (!editor) return;
    const href = linkDraft.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href === "") chain.unsetLink().run();
    else chain.setLink({ href }).run();
    setLinkOpen(false);
  }

  function removeLink(): void {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        role="toolbar"
        aria-label="Note formatting"
        className="flex flex-wrap items-center gap-1"
      >
        <button
          type="button"
          aria-label="Bold"
          title="Bold"
          aria-pressed={active?.bold === true}
          disabled={editor === null}
          className={buttonClass(active?.bold === true)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run((chain) => chain.toggleBold().run())}
        >
          <Bold size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Italic"
          title="Italic"
          aria-pressed={active?.italic === true}
          disabled={editor === null}
          className={buttonClass(active?.italic === true)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run((chain) => chain.toggleItalic().run())}
        >
          <Italic size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Inline code"
          title="Inline code"
          aria-pressed={active?.code === true}
          disabled={editor === null}
          className={buttonClass(active?.code === true)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run((chain) => chain.toggleCode().run())}
        >
          <Code size={13} aria-hidden="true" />
        </button>

        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--hairline)]" />

        <button
          type="button"
          aria-label="Text"
          title="Text"
          aria-pressed={active?.paragraph === true}
          disabled={editor === null}
          className={buttonClass(active?.paragraph === true)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run((chain) => chain.setParagraph().run())}
        >
          Text
        </button>
        {HEADING_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-label={`H${level} heading`}
            title={`H${level} heading`}
            aria-pressed={active?.heading === level}
            disabled={editor === null}
            className={buttonClass(active?.heading === level)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run((chain) => chain.toggleHeading({ level }).run())}
          >
            H{level}
          </button>
        ))}

        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--hairline)]" />

        <button
          type="button"
          aria-label="Bulleted list"
          title="Bulleted list"
          aria-pressed={active?.bulletList === true}
          disabled={editor === null}
          className={buttonClass(active?.bulletList === true)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run((chain) => chain.toggleBulletList().run())}
        >
          <List size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Numbered list"
          title="Numbered list"
          aria-pressed={active?.orderedList === true}
          disabled={editor === null}
          className={buttonClass(active?.orderedList === true)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run((chain) => chain.toggleOrderedList().run())}
        >
          <ListOrdered size={13} aria-hidden="true" />
        </button>

        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--hairline)]" />

        <button
          type="button"
          aria-label="Link"
          title="Link"
          aria-expanded={linkOpen}
          aria-pressed={active?.link === true}
          disabled={editor === null}
          className={buttonClass(active?.link === true)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (linkOpen ? setLinkOpen(false) : openLink())}
        >
          <LinkIcon size={13} aria-hidden="true" />
        </button>
      </div>

      {linkOpen ? (
        <fieldset className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-panel p-1">
          <legend className="sr-only">Link address</legend>
          <label htmlFor={linkId} className="sr-only">
            Link address
          </label>
          <input
            ref={linkInput}
            id={linkId}
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
            placeholder="https://example.com"
            className="h-7 min-w-0 flex-1 rounded border border-line bg-panel px-2 text-[12px] text-ink placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2"
          />
          <button type="button" className={buttonClass(false)} onClick={applyLink}>
            Apply
          </button>
          <button type="button" className={buttonClass(false)} onClick={removeLink}>
            Remove
          </button>
          <button type="button" className={buttonClass(false)} onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </fieldset>
      ) : null}
    </div>
  );
}
