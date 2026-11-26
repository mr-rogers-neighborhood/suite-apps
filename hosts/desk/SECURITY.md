# Suite Desk security

The Suite host is a spike. It opens local packs, so the pack is the untrusted side and the host is
the trust boundary. The reporting channel and supported state are in the root
[security policy](../../SECURITY.md); this page owns the desktop host's threat model.

- **A pack is renderer-only.** It runs in a sandboxed renderer with context isolation, no Node and no
  `nodeIntegration`. It loads from `suite-pack://<container>.<id>` on its own
  `persist:<container>:<id>` session.
- **Pack identity is derived, not claimed.** The main process maps the sender's `webContents` to a
  pack and scopes every document call by that mapping. A pack id in a request is ignored.
- **Documents and files are scoped bytes.** The pack names a document or a relative path inside its
  own root; slashes (for a document), `..`, control characters and absolute paths are refused before
  the filesystem is reached. The `files` store proves every real path is inside the root, refuses
  symlinks and owns locks and backups. The host never parses a pack document.
- **External files need the person and the `files` capability.** `pickOpen` and `pickSave` show a
  host-owned platform dialog; the absolute path stays in the main process and the pack gets only an
  opaque token plus `{ name, size, mtimeMs }`. Filters are validated as data (a plain name and bare
  lower-case extensions without a dot), and a filter name may not contain a path separator or a glob
  metacharacter. A pack without `files` gets a rejection before the dialog opens. A token is scoped
  to the sender's `(container, pack, tab)`; another pack or tab is refused, and `importFile` can only
  copy from a handle the sender owns. Every handle a tab holds is released when its view is
  destroyed, crashes (`render-process-gone`) or is replaced by a navigation.
- **External I/O is capped and errors are pathless.** Reads and writes use the pack-host default
  (`PACK_FILE_MAX_BYTES`, 256 MiB). `pickSave` does not create or truncate the destination; a write
  goes to a temporary sibling and is renamed over the destination only on success, so a failed write
  leaves the previous file in place and removes the temporary file. `importFile` copies into the
  pack's own `files` root and refuses an oversized source. A filesystem error carries a path in its
  message, so the host logs the original and returns a sentence that names no file.
- **Network is denied by default.** A pack without the `network` capability may load only its own
  protocol origin; its session cancels everything else and the protocol handler sets a CSP. A
  network-capable pack may reach HTTPS and WSS only. Handing a link to the OS browser is egress
  outside that session, so `openExternal` and a pack's `window.open` are refused without `network`;
  only the chrome's own host link opener is ungated.
- **Permissions are denied wholesale.** A pack cannot open a window, navigate to another origin,
  grant itself a permission or reach the updater.
- **The space document is host-owned and validated.** It is the one document the host parses. If it ever
  arrives from another device it must be treated as untrusted input: Zod-validate it, size-limit it,
  and never store paths, commands or executable actions in it.
- **Install is host-only and verified before extraction.** Only the chrome bridge can invoke it; the
  pack bridge has no install channel. The archive is read with a 64 MiB cap, the manifest signature
  must match the pinned key and every listed file hash must match before anything is written, and
  duplicate entries, extra files and traversal paths are refused. The layout is
  `<dataRoot>/packs/<id>/<version>`; no absolute path or archive name is returned to a renderer.

## The limit

This is capability-level isolation inside one OS sandbox, not a separate OS sandbox per pack. A
compromised host can read everything it brokers, and a Chromium escape is still a Chromium escape.
The README and the decision record state that trade.

A local actor who can already write the data directory can race a symlink between the `lstat` check
and the read; a pack cannot create a symlink, so that actor is outside this boundary. Closing it
would need `O_NOFOLLOW` and is not part of this spike.

Unsigned directory packs require `SUITE_DESK_DEV_PACKS=1` in an unpackaged checkout. They are not a
release path; a packaged build ignores the switch. A release build loads only installed packs whose
manifest signature and every file hash verified against the pinned key before extraction.

## Reporting a vulnerability

Report privately through the root [security policy](../../SECURITY.md). Do not open a public issue
for a pack that escaped its sandbox, read another pack's bytes or reached the network without
`network`.
