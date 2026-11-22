# `@suite/pack-host`

Host-side mechanics for Suite packs. No Electron import: the Electron host wraps these pieces.

## `PackFileStore`

A filesystem scoped to one pack's root. A pack gets relative paths; the host proves every real path is inside the root.

- Absolute paths, `..`, `.` segments, backslashes, control characters and empty segments are refused.
- `realpath` checks every existing ancestor; a symlinked parent cannot move an operation outside the root.
- `lstat` refuses a final symlink, device or other non-regular file.
- `write` is atomic by default (temp + rename) and can require `expectedMtimeMs`, so a stale writer loses instead of overwriting.
- `backup` copies the current bytes to a dated sibling and returns the relative backup path.
- `lock` is one writer per path in this host process; the host releases locks when a view dies.
- Errors are codes and generic messages; Node's absolute paths are logged by the host, never handed to a pack.

```ts
const files = await PackFileStore.open("/home/person/Documents/Suite/Default/Canvas");
await files.write("boards/today.canvas", bytes, { expectedMtimeMs });
const entries = await files.list("boards");
const backup = await files.backup("boards/today.canvas");
```

## Pack archives

`readPackArchive` and `buildPackArchive` are the `.suitepack` zip reader and writer. They import no Electron and add no host policy of their own beyond the archive rules. Import them from `@suite/pack-host/archive` when the root export's Node file store is not wanted; that subpath is the one Suite Go bundles.

- `readPackArchive` streams the zip, checks each entry's declared size before decompressing and the bytes produced after, and refuses unsafe paths, duplicate names, symlinks and other non-regular entries, more than `maxFiles` entries, and an archive with no `manifest.json` at its root. It returns the raw manifest bytes and a `Map` of payload files; the caller parses and verifies the manifest with `@suite/pack`.
- `buildPackArchive` writes the manifest first and the payload in code-unit path order, with a fixed timestamp on every entry, so the same manifest and files produce the same bytes on any machine and the `.sha256` sidecar is reproducible. A payload named `manifest.json` is refused.
- A failure is a `PackArchiveError` with one of `invalid-zip`, `too-large`, `too-many-files`, `invalid-path`, `duplicate-path`, `missing-manifest` or `not-regular`, and a message that names no absolute path.

```ts
const archive = await readPackArchive(bytes);
const manifest = parsePackManifest(JSON.parse(new TextDecoder().decode(archive.manifestBytes)));
if (!manifest.ok) throw new Error("untrusted manifest");

const repacked = buildPackArchive(manifest.value, Object.fromEntries(archive.files));
```

## What this package does not own

- The mount point or container identity. The host decides where a pack's root lives.
- External file handles and pickers. Those are a separate host service.
- Pack manifests, signatures or capability policy.
- Electron windows, views or IPC.
