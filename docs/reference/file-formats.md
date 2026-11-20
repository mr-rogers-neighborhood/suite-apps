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

## Encryption and backups

The apps do not encrypt their files. Anyone with a `.canvas`, `.planner` or `.budget` file can read
it; use OS disk encryption. Backups are the app's rolling copies plus whatever the person keeps
elsewhere. The sync relay stores sealed frames, but it has no TLS and binds to loopback by default;
the header and the signed records beside the frames are visible to it.

Details per app: [Canvas desktop](../../apps/canvas/docs/reference/desktop.md),
[Planner data model](../../apps/planner/docs/reference/data-model.md), and the
[Budget README](../../apps/budget/README.md).
