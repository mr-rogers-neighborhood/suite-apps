# Security

The Suite host is a spike. It opens local packs, so the pack is the untrusted side and the shell is
the trust boundary.

- **A pack is renderer-only.** It runs in a sandboxed renderer with context isolation, no Node and no
  `nodeIntegration`. It loads from `suite-pack://<container>.<id>` on its own
  `persist:<container>:<id>` session.
- **Pack identity is derived, not claimed.** The main process maps the sender's `webContents` to a
  pack and scopes every document call by that mapping. A pack id in a request is ignored.
- **Documents and files are scoped bytes.** The pack names a document or a relative path inside its
  own root; slashes (for a document), `..`, control characters and absolute paths are refused before
  the filesystem is reached. The `files` store proves every real path is inside the root, refuses
  symlinks and owns locks and backups. The host never parses a pack document.
- **Network is denied by default.** A pack without the `network` capability may load only its own
  protocol origin; its session cancels everything else and the protocol handler sets a CSP. A
  network-capable pack may reach HTTPS and WSS only.
- **Permissions are denied wholesale.** A pack cannot open a window, navigate to another origin,
  grant itself a permission or reach the updater.
- **The space document is shell-owned and validated.** It is the one document the host parses. If it ever
  arrives from another device it must be treated as untrusted input: Zod-validate it, size-limit it,
  and never store paths, commands or executable actions in it.
- **Install is host-only and verified before extraction.** Only the chrome bridge can invoke it; the
  pack bridge has no install channel. The archive is read with a 64 MiB cap, the manifest signature
  must match the pinned key and every listed file hash must match before anything is written, and
  duplicate entries, extra files and traversal paths are refused. The layout is
  `<dataRoot>/packs/<id>/<version>`; no absolute path or archive name is returned to a renderer.

## The limit

This is capability-level isolation inside one OS sandbox, not a separate OS sandbox per pack. A
compromised shell can read everything it brokers, and a Chromium escape is still a Chromium escape.
The README and the decision record state that trade.

A local actor who can already write the data directory can race a symlink between the `lstat` check
and the read; a pack cannot create a symlink, so that actor is outside this boundary. Closing it
would need `O_NOFOLLOW` and is not part of this spike.

Unsigned directory packs require `SUITE_SHELL_DEV_PACKS=1` in an unpackaged checkout. They are not a
release path; a packaged build ignores the switch. A release build loads only installed packs whose
manifest signature and every file hash verified against the pinned key before extraction.

## Reporting a vulnerability

Use GitHub's private security advisory for
[mr-rogers-neighborhood/suite-apps](https://github.com/mr-rogers-neighborhood/suite-apps/security/advisories/new).
Do not open a public issue for a vulnerability. Include the version, the platform, and the smallest
reproduction you can.
