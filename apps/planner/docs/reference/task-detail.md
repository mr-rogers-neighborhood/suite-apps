# Task detail

The task detail surface is a dialog over the day and the inbox, not a navigation view. A row opens
it from its open-details control or from **Open details** in the row's actions menu; the reminder
submenu stays where it was. Closing returns focus to the row control that opened it.

It shows and edits the task record from [data-model.md](data-model.md): title, notes, estimate,
project, tags, due and reminder times, checklist, recurrence preset and completion history. The
record stays in the document; the only React state is the text currently being typed into a field.

## Writes

Every edit calls a typed method on the replica's `WorkspaceDocument` with a leaf patch. A title,
estimate, project, tag, due or reminder change is one `updateTask` call, which parses the merged
record with the Zod schema before it commits. Checklist add and remove write the `checklist` leaf;
toggle uses `toggleChecklistItem`. Notes use the task's Loro text through `setNote`, so an edit is a
text-container write rather than a task-record rewrite, and the textarea reads the container through
`getNote` instead of keeping its own copy.

There are no fields behind this surface that the schema does not already have, and no schema bump.

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
