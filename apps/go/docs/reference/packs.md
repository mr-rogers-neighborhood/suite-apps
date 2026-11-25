# Domain packs

How a domain arrives on a phone.

**Words.** A _domain_ is Canvas, Planner or Budget — an area of the product, and the word these docs use.
An _app_ is what a person sees: the desktop launcher says "Install Suite Canvas" and "Install or update one
app", so the shell's copy says "Install an app" and its section is headed "Apps". A _pack_ is the file that
carries an app's code. Three words for three different things, and the UI never uses the middle one for the
wrong one. This is the WeChat mini-program model with a signature: a small host,
and functional packages that are installed and removed on demand.

## The pipeline, proven on a device

| Step                                | Where                                           | Verified                                                                   |
| ----------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Build a directory of files          | `scripts/pack.mjs --dir`                        | 3 files, 0.3 KiB                                                           |
| Hash every file, canonicalise, sign | `pack.mjs` + `canonicalManifestBytes`           | Ed25519 over the manifest, SHA-256 per file                                |
| Install from bytes                  | `readPackArchive` + `src/host/packs.ts`         | Signature and every hash checked, files written to `packs/<id>/<version>/` |
| Import the installed entry          | `import(entryUrl)`                              | `probe-pack-loaded` exported and read back                                 |
| Re-verify before offering a pack    | `discover()`                                    | Every installed file re-hashed; a tampered pack is not listed              |
| Its relative assets resolve         | `fetch(new URL('./assets/note.txt', entryUrl))` | `hello from a pack asset`                                                  |
| Its WASM instantiates               | `WebAssembly.instantiate` on a relative `.wasm` | 8 bytes, instantiated                                                      |
| Uninstall returns the space         | `Filesystem.rmdir` on `packs/<id>`              | 38 KiB → 4 KiB                                                             |
| An untrusted signer is refused      | `verifyPackSignature`                           | `reason: "unsigned"`                                                       |
| A tampered file is refused          | `verifyPackFiles`                               | `reason: "hash"`                                                           |

## The archive is untrusted

`install` no longer hands the bytes to `unzipSync`. It calls the shared
`readPackArchive` from `@suite/pack-host/archive`, the same reader the desktop host uses. The
reader streams the zip, checks each entry's declared size before decompressing it and the bytes
actually produced after, and refuses unsafe paths, duplicate names, symlinks and other non-regular
entries, too many files, and totals past its caps. The loader then refuses an archive with no
`manifest.json`, a manifest this build cannot parse, an unlisted file, a missing listed file, a
signature it does not trust, or a file whose hash does not match.

The caps are the reader's defaults — 64 MiB compressed, 64 MiB per file, 128 MiB total and 2048
entries — plus `MAX_ARCHIVE_BYTES`, which the store passes explicitly. Only files the manifest
lists are written, so an extra entry in the archive never reaches the disk.

**Loading re-checks the disk, not just the manifest.** `discover` parses the installed manifest,
verifies its signature, compares the directory's file set with the manifest, and re-hashes every
listed file. A pack whose bytes changed after install is refused and reported through
`issues()` with the same `files` reason install uses, rather than being offered as a module that
will run something other than what was signed.

## The catalogue reads the same index as the desktop

**Browse apps** on home shows what the published index offers next to what is installed. The
index is `https://flatpak.suite.run/index.json`, the same URL the desktop shell reads, and it is
verified by `@suite/pack`'s `parsePackIndexJson` and `verifyPackIndex` — Go does not implement a
second parser. The operator key is pinned once in `packages/pack/src/pinnedKey.ts` and imported by
both hosts, so a rotation is one constant and one release rather than two edits that can disagree.

Every one of these is a refusal before a row appears, not a warning beside it:

| Refusal                             | Check                                 |
| ----------------------------------- | ------------------------------------- |
| unsigned or malformed               | `parsePackIndexJson`                  |
| changed after signing               | an operator signature does not verify |
| a key this host does not pin        | the pinned operator key               |
| expired                             | `expires` against the phone's clock   |
| lower `sequence`                    | the recorded head                     |
| broken `previous` chain             | the recorded head's digest            |
| fewer signatures than the threshold | `threshold` in the signed bytes       |

The head is written to the app's key-value store only after every check passed, so a lower
sequence or a broken chain is refused on the next launch as well. Refreshing on the same index is
not a replay: the bytes are identical, so the signature and expiry are checked again and the head
stays where it was. Nothing about the phone is sent: one request for the index and one for the
archive a person chose, each with an `accept` header only.

## Installing from a row

The index entry's `sha256` and `size` are checked before the zip reader opens the archive
(S12.7), and the manifest's id and version must match the row that was displayed. The layout is
the desktop's: `<dataRoot>/packs/<id>/<version>/`, highest valid semver active. The desktop does
not put the publisher id in that path — it keeps a `publisher.json` beside the versions — so Go
matches the path exactly rather than inventing `packs/<publisher>/<id>/`.

| Action    | What happens on disk                                                             |
| --------- | -------------------------------------------------------------------------------- |
| Install   | A new `<id>/<version>/` is written into a `.tmp-` sibling and renamed into place |
| Update    | A second version directory appears; the previous one stays for rollback          |
| Reinstall | The same version is swapped through a backup after the new files verified        |
| Remove    | `packs/<id>` is removed; the pack's documents live outside it and stay           |

A failed install or update leaves the previous version active: the new files were never renamed
into a version directory, and the swap restores the old directory if the rename fails. Removal
asks once and says the documents stay.

## The capabilities a pack may declare

Go serves `documents`, `storage`, `files`, `recents`, `notifications` and `network` to a pack. It
does not serve `relay`, `commands` or `identity.pack`; a pack that asks for one of those is refused
at install **and** on every load, and the sentence names the capability rather than hiding the pack.
The desktop has its own list because it serves a different surface; both refuse a pack they cannot
run instead of installing it.

`files` is the pack's own scoped store plus the platform picker and share sheet. A pack sees relative
paths inside its root; another pack's root, a climb and an absolute path are refused before a
filesystem call. [The contract](contract.md#files-belong-to-one-pack) states the refusals and the
atomic-write rule.

## Why `/_capacitor_file_/` is the whole trick

A pack's code, WASM and fonts have to resolve against the pack's own directory, or every domain would
need its own server or its own origin. Capacitor's local server proxies `/_capacitor_file_/<absolute
path>` to the real filesystem (`WebViewLocalServer.java:682`), so an installed pack is served from
`https://localhost` like the shell's own bundle. `import.meta.url` inside a pack is the pack's URL, so a
relative `./assets/x.wasm` resolves to the pack. No second server, no custom scheme, no `blob:` origin.

## Hosting modes, and what "isolated" means

`isolation: "shared" | "isolated"` on the manifest. An `isolated` pack's entry is an HTML page and it
renders in its own `<iframe>`; a `shared` pack's entry is a module.

Verified on the emulator with a real pack: the frame loads `…/packs/probe/2.0.0/index.html`, its
`contentWindow` is a separate realm, the pack calls `ready` and gets `module probe` back, creates a
document through the host, saves twice, and the text is still there after leaving and reopening.

|              | `shared`                     | `isolated`                                       |
| ------------ | ---------------------------- | ------------------------------------------------ |
| Document     | The shell's                  | Its own                                          |
| React        | One, shared                  | Its own bundle                                   |
| CSS          | Shares the shell's preflight | Its own scope                                    |
| Heap / crash | Shared                       | **Shared — an iframe is not a separate process** |

**Measured, not assumed.** A pack that holds 640 MB in the frame, read back through the shell:

|                          | Shell JS heap |
| ------------------------ | ------------- |
| Before opening the frame | 14 MB         |
| Frame open, empty        | 14 MB         |
| Frame holding 640 MB     | **14 MB**     |

So the frame has its own JS heap: a runaway domain exhausts its own isolate and throws there rather
than starving the shell. That is stronger than "an iframe is not a process" implies, and it means
document isolation covers the failure that actually happens — a domain allocating without bound.

What it still does not cover is **process-level** memory: the frame and the shell share a renderer
process, so if total RSS exceeds what Android allows, the whole process goes. Whether that matters for
Canvas is a measurement against Canvas, not an argument.

## The durability boundary

A pack owns its document, so the shell can carry it but cannot write it. At the boundaries a phone
gives us — foreground loss, leaving the module, closing the app — the shell sends the pack a
`flush` control on the frame protocol and waits for the reply before removing the frame. The pack
answers only after its own write settles, or with a failure the shell can report.

Control ids are negative. The pack's requests count up from 1, so a control reply can never be
mistaken for a reply to a request when both are in flight. This is generic: the shell says
"flush", not "save Planner".

Planner is the first pack to use it, and [`planner.md`](planner.md#the-pack-owns-the-document) records
what its prelude does with the boundary.

## Why `shared` is not wired yet

The plan was an import map: the shell publishes React at a stable URL, packs mark it external, both
resolve to one instance. **That is blocked by the toolchain, not by configuration.** React 19 ships
CommonJS only, and Vite 8's bundler refuses to externalise it — `Dynamic require of "react" is not
supported`, then, with only `react` external, `Calling require for "react" in an environment that
doesn't expose the require function`. Two attempts, both failing at runtime on a device with a blank
screen and no useful message in the build log.

So `shared` packs currently report that they need the shared host rather than mounting a blank frame.
Unblocking it means one of: a bundler that can externalise CJS, a CJS→ESM build of React kept in step
with upgrades, or accepting that every pack carries its own React and is therefore isolated by
definition. The third is where the evidence points.

## Two findings that only appeared on a second device

**Ed25519 is not universally available in WebCrypto.** The Pixel's Vanadium has it; the emulator's
WebView answers `Unrecognized name`. The old verification caught that and returned `false`, so the app
told the person their pack's "signature does not match" — blaming the pack for the host's shortcoming.
Verification now uses a pure implementation (`@noble/ed25519`, the same family the sync protocol
already depends on), so there is no such gap. **Test cryptographic primitives on more than one WebView
before claiming them.**

**The manifest has to be written to disk, not just read from the archive.** Install wrote the payload
files and skipped `manifest.json`, so a pack installed fine, appeared in memory, and vanished on the next
launch because discovery had nothing to read. `writeFile` also rejects a plain string — it wants base64 —
so text goes through one symmetric helper rather than two assumptions.

## Three things that will bite later

**1. ESM caches modules by URL.** Reinstalling a pack at the same path serves the old module — the
dynamic `import()` returns the cached instance. Found by hitting it: an updated `index.js` at an
unchanged URL kept returning the previous exports. Version directories handle upgrades, but a
same-version reinstall needs a cache-busting query built from the manifest hash. The loader should use
`?v=<short-hash>` rather than relying on the path alone.

**2. Two Reacts would break every hook.** A pack that bundles its own React, mounted in the shell's
document, is two React instances and an "invalid hook call" at the first `useState`. There are two honest
answers and they are the same fork as the isolation question:

- **Import map.** The shell publishes React and ReactDOM at stable URLs; packs mark both external. One
  React, and packs stay in the shell's document.
- **Own WebView per pack.** Each pack gets its own document and its own React. This is closer to what
  WeChat does — it gives each mini program its own thread and its own copy of the runtime — and it also
  removes the Tailwind preflight collision, the shared-heap out-of-memory risk and the CSS bleed, at the
  cost of a page life per switch.

The second is the shape Canvas needs, and it is why the isolation spike is not optional. **Not decided
here**, because it changes how every pack is built.

**3. The key is the trust boundary.** `SUITE_PACK_PUBLIC_KEY` in `packages/pack/src/pinnedKey.ts` is
pinned and never fetched: a feed that could hand over a new key has handed over the app.
`PACK_PUBLIC_KEY` in `apps/go/src/host/packs.ts` only re-exports it, because a second copy is a second
trust root, and a rotation edits the shared pin and rebuilds every pack. The value in the repository
today is a **development key** that exists so the pipeline could be exercised before there is a release
process. The release key replaces it in the same change that signs packs in CI, and its private half
never enters this repository.

## What a pack may not do

- Name a file outside itself. `.`/`..`, absolute paths, backslashes and control characters are refused
  by `isSafePackPath`, a path that appears twice is refused, a symlink or other non-regular entry is
  refused, and an `entry` the manifest does not list is refused too.
- Carry a file the manifest does not list, or omit one it does. Both are refused before anything is
  written, and the installed directory is checked against the manifest again on every load.
- Claim a contract the host does not implement. `contractVersion` and `minimumHostVersion` produce a
  sentence a person can act on, not a crash at the first missing method.
- Arrive without a signature. An unsigned or damaged pack is refused whole; the installed version stays.
- Reach the network it did not declare. A pack without the `network` capability must ship a
  Content-Security-Policy of its own with `default-src 'self'` and `connect-src 'none'` (or `'self'`,
  which Loro needs to fetch its own `.wasm`). The install refuses it otherwise.

## The one capability a policy can enforce

`network` was described as advisory for a year on the reasoning that the host cannot stop a same-origin pack
from calling `fetch`. That was true and beside the point: **a document's own CSP is enforced by the browser
whatever origin it shares.** So the host does not have to block the request — it refuses to install a pack
that has not blocked it for itself, and because every file is hash-checked against the manifest, what was
checked at install is what runs.

Measured on the emulator:

| Check                                                      | Result                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `fetch('./manifest.json')` from inside the pack            | **200** — same-origin, which is how the wasm loads                                                    |
| `fetch('https://example.com/beacon')` from inside the pack | refused, with `securitypolicyviolation` naming `violatedDirective: "connect-src"` and the blocked URI |

Two details that cost time and are worth keeping:

- **`connect-src 'none'` blanks the frame for a Loro pack.** wasm-bindgen loads its `.wasm` with `fetch()`,
  and that is same-origin traffic. `'self'` is the correct value: it permits the pack's own assets and
  cannot reach a remote origin.
- **`default-src` is not optional.** The other fetch directives inherit from it, so without it
  `<img src="https://elsewhere/?d=…">` is an exfiltration channel that `connect-src` never sees.

## Still open

| Item                  | Why it is open                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| React sharing         | import map or per-pack WebView — decided with the isolation spike                                              |
| Pack updates          | async download, apply on next open, fall back to the installed version                                         |
| Preload               | prefetch on long-press, wifi-only                                                                              |
| Cross-pack imports    | the packer should fail the build when one pack imports another                                                 |
| Catalogue on a device | the index and archive paths are unit-tested; a phone still needs a signed index and one install walked through |
