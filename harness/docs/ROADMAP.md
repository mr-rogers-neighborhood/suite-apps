# Roadmap

What is next, and what "done" means for each item. Finished work moves to [Status](STATUS.md)
and leaves this list.

## Next

**1. Standalone app installs.** Each app ships an AppImage and a signed feed of its own, and works
without Start installed.
_Done means:_ a person who wants only Budget can install only Budget.

**2. Invite and join.** Add a device or another person from inside the app.
_Done means:_ no terminal step to bring a second device into a workspace.
_Shape is decided, not built:_ the handshake is written as a session type in
[Suite Go's pairing note](https://github.com/mr-rogers-neighborhood/suite-go/blob/main/docs/reference/pairing-protocol.md),
and it transports the **existing recovery kit** rather than inventing a second way back in. A **second
owner** is out of scope here: role records are flat and owner-signed, so delegating ownership is a
different decision (see F27 in the [research register](../../docs/archive/research/findings.md)).

## Later

**3. Sync inside the pack.** Planner runs in Suite Go as a signed pack, and Canvas syncs on the
desktop; neither the pack nor Budget syncs yet. The transport, the MLS group and a convergence proof
all exist, so this is wiring rather than design.
_Done means:_ an edit in the Planner pack reaches a second device, and a cold start shows it.

**4. A document that survives an app upgrade.** Every domain opens a fixture written by the previous
version, migrates it, and refuses — loudly — a document written by a newer app instead of truncating
it. The policy is
[Suite Go's ADR-0009](https://github.com/mr-rogers-neighborhood/suite-go/blob/main/docs/adr/0009-a-schema-bump-is-a-migration.md);
what is missing is one fixture and one migration chain per app.
_Done means:_ the fixture opens and keeps its content, and a document one version ahead is refused
rather than opened.

**5. A single page at the project's domain**, listing the apps, the status and the roadmap. It
should read the same content as [Status](STATUS.md) rather than duplicate it.

## Not planned

| Not doing                       | Why                                                                     |
| ------------------------------- | ----------------------------------------------------------------------- |
| macOS and Windows               | Both need a signing identity. An unsigned build is worse than no build. |
| A hosted service                | Suite operates no server. That is the product.                          |
| Server-side search or rendering | The relay is blind; it cannot read what passes through it.              |

## Priorities

Open work lives in [the issue list](https://github.com/mr-rogers-neighborhood/suite-dev/issues),
ordered by one label.

| Label             | Means                                                     |
| ----------------- | --------------------------------------------------------- |
| `priority: now`   | Blocks the next release, or breaks a promise in the docs. |
| `priority: next`  | Agreed and shaped. Nothing is blocked on it.              |
| `priority: later` | Wanted, not shaped.                                       |
