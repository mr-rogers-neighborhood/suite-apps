# Suite documentation

The cross-cutting documentation for the Suite: the hub, the apps, the sync server, and the
monorepo they live in. Each app keeps its own `docs/` beside its code; this tree owns what more than
one app needs.

Start with [What Suite is](explanation/why-suite-exists.md) for the product overview, or
[Install Suite Start](tutorials/01-install.md) if you want to run it.

## Four ways in

| | |
| --- | --- |
| [Tutorials](tutorials/index.md)<br>Learn by doing. One guided path to a first result. | [How-to](how-to/index.md)<br>One job at a time: install, package, release, contribute. |
| [Reference](reference/index.md)<br>Facts to look up: layout, commands, channels, file formats. | [Explanation](explanation/index.md)<br>Why the product and the code are shaped this way. |

Current rules are in [reference/decisions.md](reference/decisions.md). App-specific tutorials,
how-tos, reference pages and decisions stay in `apps/<app>/docs/`; the app README is the way in.

## App documentation

| App | Start here |
| --- | --- |
| Canvas | [README](../apps/canvas/README.md) · [docs](../apps/canvas/docs/README.md) · [handbook](../apps/canvas/handbook/) |
| Planner | [README](../apps/planner/README.md) · [docs](../apps/planner/docs/reference/architecture.md) |
| Budget | [README](../apps/budget/README.md) · [docs](../apps/budget/docs/reference/architecture.md) |
| Start | [README](../apps/start/README.md) · [install](../apps/start/docs/how-to/install.md) · [packaging](../apps/start/docs/how-to/package.md) |
| Sync | [README](../apps/sync/README.md) · [protocol](../apps/sync/docs/protocol.md) · [threat model](../apps/sync/docs/threat-model.md) |
| Go | [README](../apps/go/README.md) · [contract](../apps/go/docs/reference/contract.md) |

## One fact, one home

Every fact has exactly one page that owns it. Other pages link there. If a paragraph appears twice,
one copy is already wrong.

| Fact | Owner |
| --- | --- |
| The apps and what they own | [What Suite is](explanation/why-suite-exists.md) |
| Local-first goals and what is met today | [Local-first](explanation/local-first.md) |
| Host, packs and the MiniApp model | [The mini-app model](explanation/mini-app-model.md) |
| App and process boundaries | [Architecture](explanation/architecture.md) |
| The rules that shape the repository | [Decisions](reference/decisions.md) |
| Directories and packages | [Repository layout](reference/repo-layout.md) |
| Commands and the gate | [Commands](reference/commands.md) |
| AppImage, Arch package, Flatpak, update ownership | [Packaging channels](reference/packaging-channels.md) |
| Document files, folders and backups | [File formats](reference/file-formats.md) |
| Environment variables | [Environment](reference/environment.md) |
| What works, per subsystem | [Status](reference/status.md) |
| Shared vocabulary | [Glossary](reference/glossary.md) |
| Version numbers | `package.json` and each `CHANGELOG.md` |
| An app's own design | `apps/<app>/docs/` |

Never restate a version in prose here. Link to the file that holds it.

## Editing rules

- **Write for one reader need per page.** A tutorial teaches, a how-to gets a job done, reference
  states facts, explanation gives reasons. Do not mix them.
- **Link, do not copy.** Duplicated paragraphs drift, and the reader cannot tell which one is true.
- **Name the local command.** Every verification claim names the command that produced it.
- **Docs change with the code.** A change that alters behaviour, ownership or the shape of a
  document updates the page that owns it in the same change.
- **A shape change updates the rules.** Change [reference/decisions.md](reference/decisions.md) and
  the owning page; do not add a historical note.
- **No history in the reading path.** Current pages describe today. Git history is the archive.
- **Plain Markdown only.** Relative links, no site-only shortcodes. The tree must render on GitHub
  and stay portable if a site is added later.
- **Neutral voice.** State the fact. No first person, no marketing cadence, no section summary that
  repeats the heading.

`node scripts/docs-check.mjs` checks relative links, index coverage, and a short list of retired
phrases. Run it with the app gate when a change touches docs.
