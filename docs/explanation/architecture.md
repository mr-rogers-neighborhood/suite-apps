# Architecture

Suite is six applications in one repository. They share packages, a gate and a release process, but
they do not share a process, a document or a trust boundary. This page describes those boundaries;
each app's own `docs/reference/architecture.md` describes its internals.

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
  a person placed manages itself. Two copies of one app cannot run at once because they share a
  profile and its single-instance lock.
- **Go never learns a domain.** It routes on what a module declares. There is no
  `if (module.id === "planner")` in the shell, and a change that needs one belongs in that domain's
  module.
- **Go never reads a document.** Modules receive a document handle; the container does not know the
  format.

## Sync boundary

The document stays a file the app owns. Suite Sync provides the wire protocol, the membership model
and a server a person runs on a device they control. It never defines an app schema.

- Ids are fingerprints: 64 lower-case hex characters.
- Membership is a signed, append-only log (`create`, `invite`, `accept`, `set-role`, `revoke`).
- Peers exchange version vectors, then send the updates the other is missing.
- One active server per workspace in v1; there is no server-to-server federation.
- The target is a blind relay that stores ciphertext. The current room is plaintext and loopback-only
  while the transport is proven.

## Shared packages

Only code used by more than one app belongs in a shared package:

| Package | Used by | Owns |
| --- | --- | --- |
| `@suite/contracts` | Start, apps | `suite.app`, deployment, deep-link parsing, contract versioning |
| `@suite/files` | Start, apps | Envelope mechanics, base64, size limits, backup naming |
| `@suite/desktop` | Desktop apps | Electron security policy: sandbox, context isolation, fuses |
| `@suite/theme` | Desktop apps | Shared theme variables |
| `@suite/ui` | Desktop apps | Menu bar, modal, sync status and other shared chrome |

Everything else is app-private, even when it is a separate package: `@suite/graph` is Canvas's,
`@suite/planner-core` is Planner's, `@suite/budget-core` is Budget's, `@suite/go` is the mobile
contract, and `@suite/sync`/`@suite/host` belong to the sync app.

[Repository layout](../reference/repo-layout.md) lists the directories.
