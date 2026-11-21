# Suite documentation

The cross-cutting documentation for the Suite: the hub, the apps, the sync server, and the
monorepo they live in. Each app keeps its own `docs/` beside its code; this tree owns what more than
one app needs.

The primary way into the code is the explorer in Suite Help: run `pnpm docs:dev` to open the app.
These pages are the durable notes that cannot be derived from the code.

## Notes archive

The reader is not organized by Diátaxis. Its structure is **Browser / Modules / Tours** over one code
index. Reference facts come from the compiler, module narratives live in `docs/modules/*.mdx`, linear
tours live in `docs/tours/*.mdx`, and a composed tour lives in `docs/tours/*.tour.mjs`.

The older notes keep their historical grouping so links do not rot. Do not add new pages to them:
[tutorials](tutorials/index.md), [how-to](how-to/index.md), [reference](reference/index.md),
[explanation](explanation/index.md). A new explanation belongs in a module MDX; a new guided path
belongs in a tour.

Current rules are in [reference/decisions.md](reference/decisions.md), and the
[idea tracker](reference/ideas.md) records what is being considered next. The tracker is a planning
page, not a reference fact: each entry links to the page that owns the detail. App-specific notes stay
in `apps/<app>/docs/`; the app README is the way in. The Canvas handbook remains the user-facing
interface guide.

## Suite Help

`pnpm docs:dev` launches Suite Help, the shipped documentation app. It is offline, has no telemetry,
and updates through Flatpak. For a headless check, use `docs:index`, `docs:index:check`,
`docs:coverage` or `docs:build`; `docs:dev` opens an Electron window.

The explorer indexes every file and declaration and offers the three views above. The Handbook
renders these pages with the Fumadocs look. The notes stay plain Markdown and remain readable on
GitHub. The explorer is the primary interface; the notes are the fallback for facts that cannot be
derived.

## App documentation

| App | Start here |
| --- | --- |
| Canvas | [README](../apps/canvas/README.md) · [docs](../apps/canvas/docs/README.md) · [handbook](../apps/canvas/handbook/) |
| Planner | [README](../apps/planner/README.md) · [docs](../apps/planner/docs/reference/architecture.md) |
| Budget | [README](../apps/budget/README.md) · [docs](../apps/budget/docs/reference/architecture.md) |
| Start | [README](../apps/start/README.md) · [install](../apps/start/docs/how-to/install.md) · [packaging](../apps/start/docs/how-to/package.md) |
| Help | [README](../apps/help/README.md) · [AGENTS](../apps/help/AGENTS.md) |
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
| Release tiers and their promises | [Channels](explanation/channels.md) |
| App and process boundaries | [Architecture](explanation/architecture.md) |
| The rules that shape the repository | [Decisions](reference/decisions.md) |
| Directories and packages | [Repository layout](reference/repo-layout.md) |
| The shared top bar and its takeover rule | [Menu bar](reference/menu-bar.md) |
| App renderer bridge contracts | [Bridges](reference/bridges.md) |
| WCAG 2.2 coverage and manual tests | [Accessibility](reference/accessibility/wcag-22-map.md) |
| Commands and the gate | [Commands](reference/commands.md) |
| Flatpak, relay tarball, update ownership | [Packaging channels](reference/packaging-channels.md) |
| Document files, folders and backups | [File formats](reference/file-formats.md) |
| Environment variables | [Environment](reference/environment.md) |
| What works, per subsystem | [Status](reference/status.md) |
| Shared vocabulary | [Glossary](reference/glossary.md) |
| Version numbers | `package.json` and each `CHANGELOG.md` |
| An app's own design | `apps/<app>/docs/` |

Never restate a version in prose here. Link to the file that holds it.

## Editing rules

- **The explorer is the structure.** Browser, Modules and Tours are the reading model. Reference
  facts are generated; do not create a parallel section by hand.
- **Do not add a new Diátaxis page.** The four old sections are a notes archive. A new explanation
  goes in `docs/modules/`; a new guided path goes in `docs/tours/`. The
  [idea tracker](reference/ideas.md) is the one planning exception the owner asked for; it owns no
  fact and links every entry to its owner.
- **Link, do not copy.** Duplicated paragraphs drift, and the reader cannot tell which one is true.
- **Name the local command.** Every verification claim names the command that produced it.
- **Docs change with the code.** A change that alters behaviour, ownership or the shape of a
  document updates the page that owns it in the same change.
- **A shape change updates the rules.** Change [reference/decisions.md](reference/decisions.md) and
  the owning page; do not add a historical note.
- **No history in the reading path.** Current pages describe today. Git history is the archive.
- **Reference is plain Markdown.** A `.md` page uses relative links and no site-only shortcodes, so
  it renders on GitHub and in the local reader.
- **Tours are views, not copies.** A tour is an ordered list of real node IDs with optional prose. A
  composed tour may cross modules, files, symbols, tours or doc pages, but it points at content and
  never restates it. The code index does the linking; the tour never restates a signature or
  duplicates a source file.
- **One module MDX, not one file MDX.** A module's narrative and its `## <node-id>` notes live in one
  `docs/modules/*.mdx`. The explorer splits it by file and declaration at render time.
- **The reader is local.** Suite Help (`apps/help`) is the shipped documentation app. It is
  offline, keeps no canonical copy of a page, and reads the generated index plus `docs/`; Flatpak
  owns updates.
- **Neutral voice.** State the fact. No first person, no marketing cadence, no section summary that
  repeats the heading.

`node scripts/docs-check.mjs` checks relative links, index coverage, and a short list of retired
phrases. Run it with the app gate when a change touches docs.
