# File formats

Each app owns one document format. The files are ordinary files on disk; the container never parses
them.

## Where files live

| App | Folder | Extension |
| --- | --- | --- |
| Canvas | `~/Documents/Suite/Canvas` | `.canvas` |
| Planner | `~/Documents/Suite/Planner` | `.planner` |
| Budget | `~/Documents/Suite/Budget` | `.budget` |

`SUITE_START_DOCUMENTS` moves the shared root for Start. Each app also has its own library override;
see [Environment](environment.md).

## `.canvas`

Canvas writes a JSON envelope whose `kind` is `suite.canvas` and whose `version` is 3 (a `.suite`
file was v1 and v2; the reader still accepts it). The envelope carries:

- the Loro snapshot as base64;
- a manifest with counts of boards, cards, types and tags;
- attachments, each as base64 with MIME type, name and dimensions, so an image travels inside the
  file rather than beside it.

The document is opaque to the reader; only `@suite/graph` may interpret it. Canvas also exports
readable JSON and Markdown, and can write an exact backup that restores byte-for-byte.

## `.planner`

Planner writes JSON with `formatVersion`, `schemaVersion`, `workspaceId`, `createdAt` and a base64
Loro `snapshot`. The main process owns the file, the atomic temp-then-rename write, and one rolling
backup (`workspace.backup.planner`). A file opened from elsewhere keeps its own name, and its backup
and temporary file take that name.

## `.budget`

Budget writes JSON containing a base64 Loro snapshot plus its format and schema versions. Every save
is atomic, keeps the previous copy, and keeps seven daily backups beside the document under
`.backups/`. A damaged file is never overwritten: the app tries the newest backup, then opens
recovery mode with a copy in `recovered/`.

The library index (`library.json`) and `recovered/` live in the application directory, because they
describe this machine rather than the document.

## Sync relay store

The relay is not a document store. For each workspace it keeps append-only JSONL files in its data
directory:

```
<workspaceId>.frames.jsonl    sealed frames with the position the relay assigned
<workspaceId>.roles.jsonl     signed role records
<workspaceId>.invites.jsonl   signed, single-use invitations
<workspaceId>.keys.jsonl      pinned device keys and names
<workspaceId>.removed.jsonl   signed removals
```

A frame carries a readable header and a base64 MLS payload the relay never opens. There is no
`membership.json`, no `snapshot.loro` and no version vector. Retention drops the oldest frames, but
the surviving positions are not renumbered.

## Opening a file another version wrote

Each app records two numbers: a **format** version for the envelope and a **schema** version for the
document inside it. They answer different questions, and the rule that follows is the same in each
app:

- **An older document opens.** The app migrates it on open: every field a later schema added has a
  default, the migration writes the current schema number before any record is read, and the file
  carries the new version at its next save. Planner's schema 2 is the worked example: it added a
  nullable settings field, and the fixture written by schema 1 opens with its task and project
  intact.
- **A newer document is refused.** An app that sees a schema or format version above its own stops,
  leaves the file untouched and names itself and both numbers: "This workspace uses Suite Planner
  schema 3; this build understands up to 2. Open it in a newer Suite Planner." It does not fall back
  to a backup, open recovery mode, or invent a fresh document over the newer file.
- **Nothing is silently downgraded.** A file is rewritten only by the version that understands it,
  so opening with an older build never writes an older schema over newer data.

Planner enforces this in `decodeWorkspaceFile` and again in `WorkspaceDocument.fromSnapshot`, because
a file can arrive through the store or straight from the hub. Budget checks both numbers on import
and refuses a newer file rather than treating it as damaged. Canvas has checked its envelope and
schema versions since the legacy `suite.workspace` kind and migrates that kind on import.

## Encryption and backups

The apps do not encrypt their files. Anyone with a `.canvas`, `.planner` or `.budget` file can read
it; use OS disk encryption. Backups are the app's rolling copies plus whatever the person keeps
elsewhere. The sync relay stores sealed frames and binds to loopback by default; off loopback it
serves `wss://` with a self-signed certificate the app pins, so the header and the signed records
beside the frames are visible to the relay but not to a passive network attacker.

Details per app: [Canvas desktop](../../apps/canvas/docs/reference/desktop.md),
[Planner data model](../../apps/planner/docs/reference/data-model.md), and the
[Budget README](../../apps/budget/README.md).
