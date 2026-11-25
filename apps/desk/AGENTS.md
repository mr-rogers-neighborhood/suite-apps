# apps/desk

The desktop host spike. Read the repository `AGENTS.md` first, then [`README.md`](README.md) and
[`docs/reference/decisions.md`](docs/reference/decisions.md).

## Rules for this directory

- **Packs are renderer-only.** Do not add `nodeIntegration`, a pack-supplied Node entry, a raw
  filesystem API or a raw network API. A feature that needs those needs an OS-sandboxed service, not
  a wider bridge.
- **A pack never gets an absolute path.** Documents cross the bridge as an id plus bytes; pack files
  cross as a relative, slash-separated path plus bytes. Every id and path is resolved under the
  sender's own root; reject slashes (for a document), `..`, control characters and absolute paths.
  `documents` and `files` have separate roots and capabilities.
- **The sender decides the pack.** Never accept a pack id from the renderer. The main process maps
  `webContents.id` to a pack and scopes every call by that mapping.
- **The host owns the chrome.** The tab strip, launcher, capsules, dialogs and status are host
  surfaces. A pack draws only its content. Do not inject pack DOM into host chrome.
- **The space document is the host's document.** It may be parsed here. `.canvas`, `.planner`, `.budget`
  and a pack's own bytes may not.
- **One origin, one session, one pack.** Keep the custom-protocol host
  `suite-pack://<container>.<id>` and the `persist:<container>:<id>` partition together. A pack that
  loads from another origin is a bug.
- **The host owns updates.** A pack has no IPC to the updater or installer. Pack install is host-only,
  user-initiated and verified before extraction.
- **Unsigned directory packs need `SUITE_DESK_DEV_PACKS=1` and an unpackaged build.** They are a
  development convenience, not a release path. The switch is ignored in a packaged app, and a plain
  `start` loads only installed packs. Do not widen that into a release path by deleting the
  distinction.
- **Sync stays separate.** Do not put a document key or the relay inside this app. The space-document key
  is the host's own and is not an app document key.

## Checks

```sh
mise exec -- pnpm --filter @suite/desk exec biome check .
mise exec -- pnpm --filter @suite/desk exec tsc --noEmit -p tsconfig.json
mise exec -- pnpm --filter @suite/desk test
mise exec -- pnpm --filter @suite/desk build
```

Do not launch the window, `pnpm dev` or Playwright in a headless session. The gate is
`node scripts/gate.mjs --only desk`.

## Docs

A shape change updates [`docs/reference/decisions.md`](docs/reference/decisions.md) here, and the
cross-app rule in [`docs/reference/decisions.md`](../../docs/reference/decisions.md) when it changes
the host model. Keep this spike's README honest about what is not built.
