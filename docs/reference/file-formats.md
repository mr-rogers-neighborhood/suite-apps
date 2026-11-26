---
audience: developer
---

# File formats

Each app owns one document format. The files are ordinary files on disk; the container never parses
them.

## Where files live

| App | Folder | Extension |
| --- | --- | --- |
| Canvas | `~/Documents/Suite/Canvas` | `.canvas` |
| Planner | `~/Documents/Suite/Planner` | `.planner` |
| Budget | `~/Documents/Suite/Budget` | `.budget` |

Each app has its own library override; see [Environment](environment.md).

## Host documents

The host's document service keeps a pack's documents under its own data root, one folder per
container and pack:

```
<host data root>/documents/<container>/<pack>/<name>
```

That is the first-party publisher's layout, kept so an existing install is not moved. A pack from
another publisher is rooted at `documents/<publisher>/<container>/<pack>/`, because the install
identity is `(publisher id, pack id)` (S2.2): a different publisher under the same pack id starts
with no documents. The header's `publisher` field names the owner, and a header that names another
publisher is refused like one that names another pack.

Each file is a host-owned envelope (S6.1). The pack's bytes are the payload at the end of the file;
the host writes and reads the rest and never parses the payload.

```
offset 0    8 bytes   magic, the ASCII text "SUITEDOC"
offset 8    2 bytes   envelope version, big-endian (1 today)
offset 10   4 bytes   header length, big-endian
offset 14   n bytes   header: canonical UTF-8 JSON, keys in this order —
                      documentId, packId, payloadChecksum, payloadLength, publisher, schemaVersion
offset 14+n           payload: exactly payloadLength bytes and no trailer
```

`payloadChecksum` is `sha256:` plus the lower-case hex digest of the payload bytes as stored. The
header is canonical by construction — a fixed key order, no whitespace and no optional fields — so
two hosts encode the same header as the same bytes. An unknown header key is a corrupt header, not a
field to ignore: a newer envelope raises the envelope version instead.

The host owns durability (S6.2). Writes to one document are serialized; each write goes to a
temporary `<name>.tmp-<id>`, is flushed, and is renamed over the document; the previous copy stays
beside it as `<name>.bak`. On open, an unfinished temporary file is discarded, and a document that is
missing while its `.bak` is present is restored from the backup. A file whose header or checksum does
not verify is renamed to `<name>.corrupt-<timestamp>` and refused, so the person keeps the only copy
and no fresh document is created in its place.

### Declaring a pack's documents

A pack owns its schema. It declares each document in the manifest (S6.3):

```json
"documents": [
  {
    "id": "note",
    "format": "suite.note",
    "version": 3,
    "mode": "single",
    "migrations": [
      { "from": 1, "to": 2, "entry": "migrate-1-2.html" },
      { "from": 2, "to": 3, "entry": "migrate-2-3.html" }
    ],
    "projection": "project.html"
  }
]
```

| Field | Meaning |
| --- | --- |
| `id` | The document name inside `<dataRoot>/documents/<container>/<pack>/`. |
| `format` | The payload format the pack writes; the host never interprets it. |
| `version` | The schema version a current document carries. |
| `name` | The display noun a host's picker uses: `{ "singular": "Canvas", "plural": "Canvases" }`. Optional; absent means "document". |
| `mode` | `single` or `multi`; optional when the pack has one answer. |
| `migrations` | Ordered `{from, to, entry}` steps that reach `version`. |
| `projection` | A read-only entry that turns the current payload into a widget view. |

The host stamps the declared `version` into the envelope and refuses a document above it. A pack that
writes one format under many document names declares it once with `mode: "multi"`; Budget is the
worked example (`budget`, `suite.budget.snapshot`, version `1`). The host uses that declaration for
every name in the pack, so a library of budgets shares one schema answer rather than one declaration
per file.

The manifest schema validates the shape, and the host validates the chain before it writes: every
step must advance the schema, exactly one step may leave a version, no step may pass `version`, and
the chain must reach it. A gap or a fork refuses the migration and leaves the document alone.

Before the first step the host copies the whole envelope to `<name>.bak`; it then invokes each
declared entry with a handle scoped to that one document, no path and no sibling. The entry is pack
code and runs in the pack's renderer; the host passes the payload bytes in and out and never parses
them. After a step it stamps the envelope header with the step's `to` version. The envelope's schema
version is the record that a step ran, so running the same migration again invokes no entry and
leaves the document unchanged (S6.6).

An entry that cannot finish puts the backup back: the document is readable again at its old schema,
and the backup stays beside it. A projection runs only when the schema is current and writes nothing.
Migrating an app's own document remains the app's job; this is the host's declared-entry path, not a
replacement for Canvas, Planner or Budget's migration code.

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

Host documents use the same rule at two levels (S6.4). The **envelope** version belongs to the host:
a file above it is refused with a sentence naming both versions and the file's path in the data root,
and the host does not touch it, fall back to `.bak` or create a fresh document in its place. The
**schema** version belongs to the pack: the host compares it with the version the pack's manifest
declares — 1 when it declares nothing (S6.3) — and refuses a newer one the same way.
A file with no `SUITEDOC` magic was written before the envelope; this build refuses it and leaves its
bytes untouched until the pack schema work supplies a migration.

## Encryption and backups

The apps do not encrypt their files. Anyone with a `.canvas`, `.planner` or `.budget` file can read
it; use OS disk encryption. Backups are the app's rolling copies plus whatever the person keeps
elsewhere. The sync relay stores sealed frames and binds to loopback by default; off loopback it
serves `wss://` with a self-signed certificate the app pins, so the header and the signed records
beside the frames are visible to the relay but not to a passive network attacker.

Details per app: [Canvas desktop](../../legacy/canvas/docs/reference/desktop.md),
[Planner data model](../../legacy/planner/docs/reference/data-model.md), and the
[Budget README](../../legacy/budget/README.md).
