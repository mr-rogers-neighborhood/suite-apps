---
audience: user
---

# Back up and restore a document

A Suite document is a file. Closing the app and copying the file is a complete backup. The apps also
keep their own rolling copies, which cover a bad save but not a lost disk.

## Before you copy

Close the app that owns the document. Each app takes a per-file lock so two processes cannot write one
document; copying under a live window can catch a write in progress.

## Canvas

- The workspace is one `.canvas` file in `~/Documents/Suite/Canvas`. Images used in cards travel
  inside the file.
- Copy the file to wherever you keep backups. To restore, put it back and open it.
- Canvas can also write an exact backup (restores byte-for-byte) and a readable JSON or Markdown
  export. A readable export is for reading and archiving, not for restoring.

## Planner

- The workspace is `workspace.planner` in `~/Documents/Suite/Planner`, with one rolling backup
  (`workspace.backup.planner`) and a temporary file used for the atomic rename.
- Copy the main file. A file opened from another folder keeps its own name, and its backup and
  temporary file use that name.

## Budget

- The budget is a `.budget` file in `~/Documents/Suite/Budget`, with seven daily backups under
  `.backups/`.
- `library.json` and `recovered/` live in the application directory, because they describe this
  machine rather than the document.
- Budget can export CSV, QIF, native JSON or another `.budget`. Use the export when another program
  needs to read the data.

## Restore

1. Close the app.
2. Replace the damaged file with the copy, or open the copy from its new location.
3. Open the app and check the document.

Budget never overwrites a damaged file. It tries the newest backup, then opens recovery mode with a
copy in `recovered/`; the original stays where it was.

## Moving to another machine

Copy the document to `~/Documents/Suite/<App>` on the other machine and open it. Do not copy two
different documents that happen to share a name over each other.

If the document is synced, both copies carry the same sync workspace id. Two copies of one workspace
are two local replicas of one sync unit, not two independent documents. Stop the sync connection
before using a copy as an independent backup.

## Encryption

The files are not encrypted. Anyone with the file can read it. Use OS disk encryption, and treat a
copy in a cloud folder as readable by that provider.
