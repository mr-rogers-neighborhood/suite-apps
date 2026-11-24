# Glossary

The words this repository uses in more than one app. Each app's own glossary has the terms that
belong to it; Canvas's is [here](../../apps/canvas/docs/reference/glossary.md).

| Term | Means |
| --- | --- |
| **Suite** | The product family: Canvas, Planner, Budget, Sync, Help and Go, plus the Suite Desk host and shared packages. |
| **App** | A user-facing product. UI copy says "app", because the host installs apps and packs. |
| **Domain** | The architecture word for an app's subject matter. Go hosts domains; a pack carries one. It is the same three things as Canvas, Planner and Budget. |
| **Pack** | A built bundle a domain module is delivered as: a manifest, declared capabilities and the module's code. |
| **Host** | The process that installs, launches and routes to a pack: Suite Desk on the desktop, Suite Go on mobile. A host never reads a document payload. |
| **Manifest** | Three shapes with one word: `suite.app.json` beside a desktop app, `manifest.json` inside a `.suitepack`, and the update-feed manifest. The [superapp spec](../spec/superapp.md) owns the pack manifest. |
| **Capability** | A permission a pack declares in its manifest, which the host enforces. A declaration is not a user authorisation. |
| **Document** | One Loro CRDT per app workspace, stored in a file the app owns: `.canvas`, `.planner` or `.budget`. |
| **Workspace** | The unit a document belongs to. In Canvas it is also the collaboration and storage boundary. |
| **Sync workspace** | The relay's unit for one workspace: sealed frames plus signed roles, invitations, pinned keys and removals. |
| **Board** | A Canvas view that places cards. It is not the owner of a card. |
| **Card** | A Canvas object with identity, a type, fields, tags and body content. It exists without a board. |
| **Projection** | A derived, read-only representation: a view's results, a share's redacted copy, a published bundle. It is never the place the document is authored. |
| **Member** | A 64-hex device identity with a role in a sync workspace. Only an active owner invites or revokes; the signed role record is the model. |
| **Device** | A 64-hex identity for one installation that holds a document and joins a sync workspace. |
| **Epoch** | The group-key generation. A revoke bumps it; a client ignores a frame from another epoch. |
| **Blind relay** | A sync server that stores sealed frames it cannot read and cannot merge. It is what the tree runs. |
| **Session** | A period when two or more devices are connected and collaborating. A device may be signalled, but it is never woken to accept document data or a write; collaboration is a session, not a subscription. |
| **Local-first** | The copy on the device is primary; a server, if any, holds a secondary copy. See [Local-first](../explanation/local-first.md). |
| **Gate** | The local commands that verify a change. The root gate runs each app's gate; see [Commands](commands.md). |

## Two distinctions worth keeping

**App, domain and pack are three views of one thing.** A person installs an *app*; the architecture
calls its subject a *domain*; the file that carries it to a mobile host is a *pack*. A refactor must
not rename the user-facing string to match the internal term.

**A document, a file and a sync workspace are not the same.** The document is the CRDT; the file is
how one app stores it; the sync workspace is a server directory that helps devices converge. None of
them may be parsed by the host.
