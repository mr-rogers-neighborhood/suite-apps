# Suite Help

The documentation app: the code explorer and the handbook in one offline Electron window.

## What it is

Suite Help is one Vite + React renderer in an Electron shell. It has two surfaces:

- **Explorer.** Browser, Modules and Tours over a generated index of every file and declaration.
  The index is produced by the TypeScript compiler, the prose comes from `docs/modules/` and
  `docs/tours/`.
- **Handbook.** The Markdown pages under `docs/`, compiled by Fumadocs MDX and rendered through the
  Fumadocs headless source loader in React Router.

The app owns no document, has no account and has no network client. The generated index, the
handbook and the search index ship inside the bundle, so a person needs no checkout.

## Theme and mark

Help uses `@suite/theme` rather than a palette of its own. The footer of both navigators offers a
**Theme** preset and a **Brightness** mode — **System**, **Light** or **Dark** — stored per device
under `suite.theme`. The preset paints the suite role variables, the Fumadocs `--color-fd-*` names
point at those roles, and Shiki follows the resolved mode instead of a fixed code theme.

The window icon, `electron-builder` icon, Flatpak icons and Start's Help card all use the same headset
on the ink tile. Start's card mark inverts with the tile in a light theme; the packaged icon is the
same artwork.

## Commands

```sh
mise exec -- pnpm docs:index        # build apps/help/public/data
mise exec -- pnpm docs:index:check  # validate notes, tours and generated data
mise exec -- pnpm docs:coverage     # authored vs generated prose
mise exec -- pnpm docs:explain <node-id>
mise exec -- pnpm docs:dev          # Vite + Electron, foreground; not for a headless gate
mise exec -- pnpm docs:build        # generate and build the static renderer
mise exec -- pnpm docs:clean
```

The owning instructions are in [apps/help/AGENTS.md](../../apps/help/AGENTS.md) and
[apps/help/README.md](../../apps/help/README.md).

## Packaging

Help is Flatpak-only, like every desktop app in the suite. `packaging/flatpak/run.suite.help.yml`
packages the unpacked `electron-builder --dir` output, and `node scripts/flatpak.mjs --app help`
builds and publishes it to the local OSTree repository. Flatpak installs, updates and removes the
deployment, and Start lists it like the other apps.

The production renderer is served from `suite-help://app/` with SPA fallback to `index.html`. There
is no loopback HTTP server and no `next start`.
