# Environment

The apps read a small set of environment variables. Most exist to move a data root for a test or a
portable install; they are not configuration a normal user needs.

## Hub

| Variable | Replaces |
| --- | --- |
| `SUITE_START_DOCUMENTS` | the shared documents root, `~/Documents/Suite` |
| `SUITE_START_DATA` | the hub's Electron data directory (recents, theme) |
| `SUITE_START_USER_DATA` | Electron's `userData` for the hub |
| `SUITE_START_APPS_ROOT` | the managed app root, `~/Applications/Suite` |
| `SUITE_START_FEED_BASE` | the base URL of the release feed |
| `SUITE_START_REGISTRY` | the install registry file |
| `SUITE_START_FLATPAK` | the Flatpak binary Start uses |
| `SUITE_START_FLATPAK_REMOTE` | the Flatpak remote Start reads |

## Document apps

| Variable | App | Replaces |
| --- | --- | --- |
| `SUITE_CANVAS_LIBRARY` | Canvas | the documents folder |
| `SUITE_CANVAS_DATA` | Canvas | the application data directory |
| `SUITE_CANVAS_USER_DATA` | Canvas | Electron's `userData` |
| `SUITE_PLANNER_LIBRARY` | Planner | the documents folder |
| `SUITE_PLANNER_USER_DATA` | Planner | Electron's `userData` |
| `SUITE_BUDGET_LIBRARY` | Budget | the documents folder |
| `SUITE_BUDGET_DATA` | Budget | the application data directory |
| `SUITE_BUDGET_USER_DATA` | Budget | Electron's `userData` |

## Sync

The desktop apps take the relay address in their own Sync dialog. `SUITE_SYNC_URL`,
`SUITE_SYNC_MEMBER`, `SUITE_SYNC_WORKSPACE`, `SUITE_SYNC_EPOCH` and `SUITE_SYNC_DEVICE` were listed
here but no shell reads them. Start reads no relay variable: it installs and opens the Suite Sync
Flatpak, and the tray app owns the relay's configuration.

## Packaging

`SUITE_FLATPAK_REPO` and `SUITE_FLATPAK_XDG_DATA_HOME` move the output repository and the Flatpak
data root for `scripts/flatpak.mjs`. `SUITE_FLATPAK_STATE` moves the store directory for
`scripts/flatpak-remote.mjs`; `SUITE_FLATPAK_HOST`, `SUITE_FLATPAK_REMOTE_DIR` and `SUITE_FLATPAK_URL`
change where the lan target publishes and the URL it writes. `SUITE_FLATPAK_TARGET` picks `lan` or
`s3`; `SUITE_FLATPAK_S3_BUCKET` and `SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION` name the bucket and the
distribution an `s3` publish uploads to and invalidates. `SUITE_STORE_KEY_ID` names the store's
signing key when it is not the one recorded in `~/suite-flatpak/store-key.id`; `SUITE_STORE_STATE` and
`SUITE_STORE_IDENTITY` move where `scripts/store-key.sh` writes and whose name the key carries.
`SUITE_GO_KEYSTORE`,
`SUITE_GO_KEY_ALIAS`, `SUITE_GO_KEYSTORE_PASSWORD`, `SUITE_GO_KEY_PASSWORD` and `SUITE_GO_JAVA_HOME`
are used when building and signing an Android pack.

## Signing keys

The private keys live outside the repository. [Manage signing keys](../how-to/keys.md) states what
each one signs and how to rotate it; this table is only where a script looks.

| Variable | Means |
| --- | --- |
| `SUITE_KEYS_DIR` | the directory that holds both keys, instead of `~/.config/suite/keys` |
| `SUITE_PACK_KEY` | the pack signing key's text, instead of `pack-key` in that directory |
| `SUITE_UPDATE_KEY` | the update signing key's file, instead of `update-key.pem` in that directory |
| `SUITE_INDEX_KEY` | the catalogue operator key, read by `scripts/release-index.mjs` |
| `SUITE_INDEX_KEY_FINGERPRINT` | the pinned fingerprint that operator key must match |

## Development

`SUITE_SKIP_DOCKER_SECURITY=1` skips Canvas's container-based secret scan. It exists for a machine
without Docker, and a gate claim that used it should say so.

## XDG_DATA_HOME

Flatpak and Electron user data follow `XDG_DATA_HOME`. A tool that points it at a per-session
directory, such as Orca, hides the real user installation. Run with
`XDG_DATA_HOME=$HOME/.local/share` when you need to see or install into the real one.

Variables are read by the process that owns the data, not centrally. The owning app's `paths.ts` or
`main.ts` is the source of truth when one of these changes.
