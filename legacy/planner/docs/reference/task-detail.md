# Task detail

The task detail surface is a dialog over the day and the inbox, not a navigation view. A row opens
it from its open-details control or from **Open details** in the row's actions menu; the reminder
submenu stays where it was. Closing returns focus to the row control that opened it.

It shows and edits the task record from [data-model.md](data-model.md): title, notes, estimate,
project, tags, due and reminder times, checklist, recurrence preset and completion history. The
record stays in the document; React state holds the drafts for the fields that need one, never a copy
of the record.

## Notes

The note is a Tiptap 3 editor over the task's Loro note root, not a textarea. The toolbar offers
bold, italic, inline code and a link control; **Text** returns a block to a paragraph and **H1**,
**H2** and **H3** set a heading; two list buttons toggle bullets and numbering. The link control
opens a small address row with **Apply**, **Remove** and **Cancel**, so a URL has somewhere to be
typed. A button takes the selection without moving focus out of the editor, and the command runs with
focus returned to it.

The editor is labelled **Notes**; the label targets the editable region, the toolbar exposes a name
and its buttons their pressed state, and the hint under the editor says changes save as you type.
Escape closes the task dialog while the note has focus, and closing returns focus to the row control
that opened the dialog.

## Writes

Every edit calls a typed method on the replica's `WorkspaceDocument` with a leaf patch. A title,
estimate, project, tag, due or reminder change is one `updateTask` call, which parses the merged
record with the Zod schema before it commits. Checklist add and remove write the `checklist` leaf;
toggle uses `toggleChecklistItem`.

Notes are different. The editor binds to the task's `LoroMap` root through
`loro-prosemirror`, and each ProseMirror transaction writes into that root; the replica's single
`observe` subscription forwards the update, so there is no save action and no note copy in React
state. `TaskNotesEditor` reads the root with `getNoteDoc`, and `getNote` supplies the words — flattened
from the rich map, or the legacy text when no map exists yet.

There are no fields behind this surface that the schema does not already have, and no schema bump:
the note root sits beside the task record.

## Refusals

A value the schema would reject is refused beside the field with a sentence, and the record is left
as it was:

- an empty title;
- an estimate that is empty of everything except digits, zero, or negative (empty means null);
- a due or reminder value that is not a real date and time (empty means null);
- a checklist item with no title;
- a recurrence preset on a task with no scheduled day, because the series needs an anchor.

Clearing a field that the schema allows to be null — estimate, project, due, reminder, recurrence,
tags, checklist — writes that null or empty value.

## Recurrence presets

The select offers **Does not repeat**, **Every day**, **Every week** and **Every month**. Choosing a
preset writes interval 1 with no weekday restriction, which is the same-day or same-date rule the
anchor implies, and keeps an existing end date. A rule stored with a finer interval still reads as
its frequency's preset; choosing the preset again is how it is reset to the everyday case.
Occurrences are projected by `occurrencesBetween`; nothing is materialised.

## Completion history

The history section reads `completedAt` for a one-off completion and `recurrenceCompletions` for the
occurrences already done. It is a projection of stored fields, so it changes when another replica
completes the task and needs no separate record.
