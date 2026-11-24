# Install, update and remove apps

Suite Desk is the desktop host and the way in. [Install the host](../../apps/shell/README.md#install-as-a-flatpak)
once, then install, update, remove and reinstall packs from its catalogue. A `.suitepack` file still
installs on its own. [The shell's README](../../apps/shell/README.md#installing-updating-and-removing-a-pack)
owns that lifecycle, and neither the host nor an app edits a document.

The frozen Canvas, Planner, Budget and Help Flatpaks keep the one `flatpak install` line the release
page prints. Suite Start no longer exists (#314); its catalogue and Home moved into the shell. Suite
Sync is retired as a shipped app (#315): the signed remote keeps its last published ref, but no new
`run.suite.sync` build is published and the tray app is not the target surface.

## Install the host

```sh
flatpak remote-add --user --if-not-exists --from suite https://flatpak.suite.run/suite.flatpakrepo
flatpak install --user suite run.suite.shell
```

Updates arrive through Flatpak: `flatpak update --user` replaces the deployment, and the host does not
check for or install its own update. From a checkout, `node scripts/flatpak.mjs --app shell` builds the
same unpacked tree into the local store.

## Install a pack

Home's `shell.apps` widget shows the catalogue. A trusted entry offers **Install**, **Update** or
**Reinstall** as its state requires; a refused entry stays visible with the sentence that explains it
and cannot be installed. A `.suitepack` file can also be opened on its own. Removing a pack leaves its
documents and files on disk until the person removes them.

## Install a frozen Flatpak

The frozen apps are not packs yet. Each keeps its last signed deployment:

```sh
flatpak install --user suite run.suite.canvas
flatpak install --user suite run.suite.planner
flatpak install --user suite run.suite.budget
flatpak install --user suite run.suite.help
```

The signed remote is the same one the host uses. A new build updated the deployment with
`flatpak update --user`; the apps are frozen, so there is no new release until each becomes a pack.

## The relay

Suite Sync is no longer an app to install. The relay becomes a host capability (#315); until the host
runs it, a person runs the headless CLI from a checkout or from the last `run.suite.sync` ref the
signed remote keeps. There is no new build and no tray app:

```sh
node apps/sync/dist/cli.js serve --host 127.0.0.1 --port 8787 --trust-all
```

The relay remains a separate trust boundary: it stores sealed frames, never a document.
[Leave a relay running](../../apps/sync/docs/how-to/relay.md) owns the operation guide.

## What happened to Suite Start

Suite Start was the legacy Flatpak hub. It has been removed; nothing in the tree reads its install
records or its Screen files, and no migration runs. Install the host and its packs instead. A person
who still has Start installed can remove it with `flatpak uninstall --user run.suite.start`; the
documents the frozen apps wrote in `~/Documents/Suite` are untouched.

See [Packaging channels](../reference/packaging-channels.md) for the form, the signed remote and who
updates it.
