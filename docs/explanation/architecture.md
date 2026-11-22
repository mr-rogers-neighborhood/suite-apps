# Architecture

Suite is six applications in one repository. They share packages, a gate and a release process, but
they do not share a process, a document or a trust boundary. This page describes those boundaries;
each app's own `docs/reference/` architecture page describes its internals.

## Three roles

| Role | Apps | Owns |
| --- | --- | --- |
| Document owner | Canvas, Planner, Budget, Go's domain modules | One document per workspace, its schema and its writes |
| Host | Suite Start (desktop), Suite Go (mobile) | Installing, launching, routing, and handing over a path or bytes |
| Service | Suite Sync | A transport, a membership log and a persisted room |

The hub is not a host in the browser sense. Start launches a separate signed process and returns a
path or a URL; it never proxies document bytes and cannot edit a document. Go mounts a domain module
inside its own window, but the module owns the document.

## The document rule

Every app follows the same rule, under different names:

- One Loro CRDT document per workspace.
- Every write is validated by a Zod schema in the app's document package (`@suite/graph`,
  `@suite/planner-core`, `@suite/budget-core`).
- UI state may live in Zustand or React state. Document truth never does.
- Components never touch Loro directly; they call a typed accessor or mutation on the document
  object.

The consequence is that a file is the unit of ownership. `.canvas`, `.planner` and `.budget` are
different shapes owned by different apps. The container carries bytes and a name; it does not parse
them.

## Host boundaries

Suite Start and Suite Go enforce the same separation in different places:

- **Start is not in the data path.** It writes an install record and launches an executable. A
  manifest (`suite.app.json`) says what an app is; the install record says where the executable is. A
  manifest may not name a binary, so a tampered manifest cannot redirect a launch.
- **Start owns only what it installed.** A copy Start placed is Start's to update and remove. A copy
  a person placed is not Start's to update. Two copies of one app cannot run at once because they
  share a profile and its single-instance lock.
- **Go never learns a domain.** It routes on what a module declares. There is no
  `if (module.id === "planner")` in the shell, and a change that needs one belongs in that domain's
  module.
- **Go never reads a document.** Modules receive a document handle; the container does not know the
  format.

## Sync boundary

The document stays a file the app owns. Suite Sync provides the wire protocol, the membership model
and a server a person runs on a device they control. It never defines an app schema.

- Ids are fingerprints: 64 lower-case hex characters.
- Membership is an MLS group plus signed role records; an invitation is a single-use join capability.
- A device seals one document update into one frame, and the relay numbers, stores and forwards it.
- One active relay per workspace in v1; there is no server-to-server federation.
- The relay stores sealed frames it cannot read, plus the signed metadata it needs to admit them. It
  is loopback by default; a reachable relay serves `wss://` with a self-signed certificate the app
  pins by SHA-256.

## The desktop superapp boundary

Desktop Suite is separate sandboxed apps plus Start as the shell. It is not one application that
mounts domain code. Start owns the catalogue, the channels, routing and updates; Flatpak is the host
runtime when an app is installed that way, and Start asks it to install, update or remove rather than
writing a deployment itself. The hub ships as a Flatpak too: inside that sandbox it reaches the host's
Flatpak service through the Flatpak session helper. Documents and keys stay with the app: Start hands
over a path or bytes, never parses them, and sync keys never enter it.

That is the released form, and it remains so until the migration is proven.
[`apps/shell`](../../apps/shell/README.md) is the intended successor: one Electron app with a
`WebContentsView` per pack, each in its own custom-protocol origin and session partition, rendering a
signed pack instead of launching a separate process. It is not the same-process mount this section
rejects, because the boundary moves from the OS sandbox to a per-pack renderer, origin and session. A
real shipping app — Budget first — has to run as a signed pack with its documents and consented
export/import before Start stops shipping. [Shipping packs](../reference/decisions.md#shipping-packs)
owns the rule; the released apps remain separate Flatpaks and Start until then.

### Why not one container window

The obvious alternative is one window that mounts every domain in the shell's process. It loses the
boundaries the suite relies on. One crash takes the shell and every open domain with it; a renderer
bug can read another app's memory; accessibility is per window and per document, so a container that
draws its own chrome gives the platform one surface instead of each app's; and one release owns every
domain's cadence. Mobile Go accepts a narrower version of this trade because it mounts a pack inside
its own window and keeps a document boundary instead of a process boundary. Desktop keeps the process
boundary.

### Why not a host agent now

A host agent that owns installations is not built now. A sandboxed Start reaches the host's own
Flatpak through the Flatpak session helper (`org.freedesktop.Flatpak`, used with
`flatpak-spawn --host`), behind the same `PackageBackend` the native build implements. That grant is
effectively host command execution; it is the trade that lets a Flatpak hub manage deployments.

A D-Bus agent remains the alternative if the permission set grows. It would be a second package
manager until it earns its keep: install, update, remove and launch would exist twice, with its own
trust boundary, and it would duplicate what Start already does through the seam.

### Why not one service owning sync keys

A device-wide sync service that owned membership and group keys would be simpler to implement once,
and it would collapse the sandbox isolation the apps depend on. A process that can open every
workspace's frames is a single compromise of every document. The sync capability keeps the key and
the document in the app; the host moves sealed frames and the metadata the threat model already
accepts. Go reserves the same capability for a future host.

### What the MiniApp model contributed

The W3C MiniApp work supplied four mechanisms the suite's host model uses: a host that launches
packaged apps, a manifest that declares what the app is, declared capabilities the host enforces,
and a lifecycle that distinguishes a running app from a disposed one. It supplied no compliance
target: the MiniApp Packaging specification is
[retired](https://www.w3.org/standards/history/miniapp-packaging/), so no build is certified against
it. The model is an influence, not a standard Suite conforms to;
[The mini-app model](mini-app-model.md) owns the comparison.

The two host seams are named rather than implied: [Start's decisions](../../apps/start/docs/reference/decisions.md)
state the `PackageBackend` rule, and [the sync capability](../../apps/sync/docs/reference/sync-capability.md)
states the sealed-frame contract.

## Shared packages

Only code used by more than one app belongs in a shared package:

| Package | Used by | Owns |
| --- | --- | --- |
| `@suite/contracts` | Start, apps | `suite.app`, deployment, deep-link parsing, contract versioning |
| `@suite/files` | Start, apps | Envelope mechanics, base64, size limits, backup naming |
| `@suite/document-runtime` | Planner, Budget | Renderer replica with the single `observe` site, and the atomic main-process store |
| `@suite/desktop` | Desktop apps | Electron security policy: sandbox, context isolation, fuses |
| `@suite/theme` | Desktop apps | Shared theme variables |
| `@suite/ui` | Desktop apps | Menu bar, modal, sync status and other shared chrome |
| `@suite/pack` | Desktop host, packs, Go | Pack manifest, capabilities, contributions and Ed25519 verification |
| `@suite/pack-runtime` | Packs | Pack-side service types; no Electron or Node |
| `@suite/pack-host` | Desktop host | Scoped pack file store, locks, backups and the archive reader |

Everything else is app-private, even when it is a separate package: `@suite/graph` is Canvas's,
`@suite/planner-core` is Planner's, `@suite/budget-core` is Budget's, `@suite/budget-pack` is
Budget's desktop pack, `@suite/go` is the mobile contract, and `@suite/sync`/`@suite/host` belong to
the sync app.

[Repository layout](../reference/repo-layout.md) lists the directories.
