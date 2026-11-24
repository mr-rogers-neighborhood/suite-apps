# Architecture

Suite is one repository of apps. They share packages, a gate and a release process, but they do not
share a process, a document or a trust boundary. This page describes those boundaries; each app's own
`docs/reference/` architecture page describes its internals.

## Three roles

| Role | Apps | Owns |
| --- | --- | --- |
| Document owner | Canvas, Planner, Budget, Go's domain modules | One document per workspace, its schema and its writes |
| Host | Suite Desk (desktop), Suite Go (mobile) | Installing packs, rendering their tabs, routing a link, and handing over bytes |
| Service | Suite Sync | A transport, a membership log and a persisted room |

The host is not a document editor. The shell opens a signed pack in its own origin and session, hands
it bytes, and never parses them; it cannot edit a document. Go mounts a domain module inside its own
window, but the module owns the document.

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

Suite Desk and Suite Go enforce the same separation in different places:

- **The host is not in the document path.** It verifies a signed pack, extracts it under its own data
  directory and opens a renderer on a pack-owned origin. The scoped document API carries opaque bytes
  and a pack id, never another pack's path.
- **The host owns only its packs.** A pack is removed version by version; its documents and files
  live outside the pack root and stay until the person removes them. A frozen Flatpak is not the
  host's to update: Flatpak owns that deployment.
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

Desktop Suite is the host plus signed packs, with the frozen Flatpaks still shipped beside them. It is
not one application that mounts domain code. [`apps/shell`](../../apps/shell/README.md) is one
Electron app with a `WebContentsView` per pack, each in its own custom-protocol origin and session
partition, rendering a signed pack instead of launching a separate process. It owns the catalogue,
Home and the Screens manager; Flatpak owns the host's own deployment and the frozen apps' deployments.
Documents and keys stay with the app: the host hands over bytes, never parses them, and sync keys
never enter it.

That is the released form after Start's retirement (#314). It is not the same-process mount this
section rejects, because the boundary moves from the OS sandbox to a per-pack renderer, origin and
session. [Shipping packs](../reference/decisions.md#shipping-packs) owns the rule.

### Why not one container window

The obvious alternative is one window that mounts every domain in the shell's process. It loses the
boundaries the suite relies on. One crash takes the shell and every open domain with it; a renderer
bug can read another app's memory; accessibility is per window and per document, so a container that
draws its own chrome gives the platform one surface instead of each app's; and one release owns every
domain's cadence. Mobile Go accepts a narrower version of this trade because it mounts a pack inside
its own window and keeps a document boundary instead of a process boundary. Desktop keeps the process
boundary.

### Why not a host agent now

The host is not a Flatpak package manager. It verifies and unpacks signed packs into its own data
directory, and Flatpak handles the host's own deployment and the frozen apps. A host agent that
managed Flatpak deployments is not built, because no suite surface asks for one after Start's
retirement.

A D-Bus agent remains the alternative if the permission set grows. It would be a second package
manager until it earns its keep: install, update, remove and launch would exist twice, with its own
trust boundary.

### Why not one service owning sync keys

A device-wide sync service that owned membership and group keys would be simpler to implement once,
and it would collapse the sandbox isolation the apps depend on. A process that can open every
workspace's frames is a single compromise of every document. The sync capability keeps the key and
the document in the app; the host moves sealed frames and the metadata the threat model already
accepts. Go reserves the same capability for a future host.

### What the MiniApp model contributed

The W3C MiniApp work supplied four mechanisms the suite's host model uses: a host that launches
packaged apps, a manifest that declares what the app is, declared capabilities the host enforces,
and a lifecycle that distinguishes a running app from a disposed one. It supplied no W3C compliance
target: the MiniApp Packaging specification is
[retired](https://www.w3.org/standards/history/miniapp-packaging/), so no build is certified against
it. The [Suite superapp specification](../spec/superapp.md) is the target for the host and pack
contract; [The mini-app model](mini-app-model.md) owns the comparison.

The two host seams are named rather than implied: [the shell's decisions](../../apps/shell/docs/reference/decisions.md)
state the pack boundary, and [the sync capability](../../apps/sync/docs/reference/sync-capability.md)
states the sealed-frame contract.

## Shared packages

Only code used by more than one app belongs in a shared package:

| Package | Used by | Owns |
| --- | --- | --- |
| `@suite/contracts` | Host, apps | `suite.app`, deployment, deep-link parsing, contract versioning |
| `@suite/files` | Apps | Envelope mechanics, base64, size limits, backup naming |
| `@suite/document-runtime` | Planner, Budget | Renderer replica with the single `observe` site, and the atomic main-process store |
| `@suite/screens` | Desktop host | The `suite.screen` shape, its Loro document and the widget registry; the host owns file IO |
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
