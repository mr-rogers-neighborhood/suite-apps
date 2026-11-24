# Installing Suite Start

Suite Start is the legacy hub for the Flatpak apps in the suite: one window that installs, updates
and opens them. It ships as the Flatpak `run.suite.start`, and every app it manages is a Flatpak too.

Suite Shell is the desktop host and the way in. [Install the host](../../../shell/README.md) once and
pick packs from its catalogue; Start is not the entry point for those. This page stays for the
Flatpak apps Start still manages until it is retired (#314).

## 1. Add the store

Add the signed remote from [Packaging channels](../../../../docs/reference/packaging-channels.md#flatpak),
then install the hub:

```sh
flatpak remote-add --user --if-not-exists --from suite \
  https://flatpak.suite.run/suite.flatpakrepo
flatpak install --user suite run.suite.start
flatpak run run.suite.start
```

A local build uses the `suite-local` remote that `node scripts/flatpak.mjs` adds. A newer hub arrives
with `flatpak update --user`, and the hub's own row offers **Update Start** only when its installed
commit differs from the newest commit on its own origin.

## 2. Open it

You get one window with a card per app the suite offers. Flatpak is the only Linux desktop form, so
there is no download, feed or second copy to choose between.

| What the card says                           | What it means                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| **Install Suite Canvas**                     | The store offers it; one press asks Flatpak to install it.                     |
| **Not installed yet · from the store**       | A Flatpak remote has it; Install asks Flatpak to install it.                   |
| **No release found**                         | Nothing is published for that app yet. The button appears when a version does. |
| `‹version›` **· Flatpak**                    | Installed from Flatpak, which is its update path.                              |
| `‹version›` **· Flatpak · update available** | The store publishes a different build; **Update** asks Flatpak to replace it.  |
| `‹version›` **· from a folder**              | A copy you placed; Start can open, reveal or forget it, not update it.         |
| **slop** badge                               | A pre-release build in its own section under one shared caution.               |
| **Switch to canary**                         | Moves the one pre-release install to another tier; it is not a second install. |

A Flatpak operation shows **Installing…** on the card because Flatpak reports no percentage. A
folder copy is first-class but not Start's to replace: it offers **Open**, **Reveal** and **Forget**,
never Uninstall or Update.

Stable and one pre-release can sit side by side: they are two ids and two cards. The pre-release cards
sit in their own section below the stable list, under one caution that names the tier risk, the single
install shared across tiers, and the `Suite Slop` folder; each card wears its stable app's mark. Every
pre-release tier shares `run.suite.slop.<app>`, so there is one pre-release install, not one per tier.
If the store publishes another branch, the card offers **Switch to …** rather than a second Install;
the install and its `~/Documents/Suite Slop/<App>` data folder stay. The badge is text (`slop`,
`canary` or `beta`) so it survives a screenshot.

The hub's own row offers **Update Start** only when the installed `run.suite.start` commit differs
from the newest commit on that deployment's own origin. A placed copy, a current build and a failed
check offer no button. Flatpak replaces the deployment, and the new build starts next launch; Start
cannot replace its own running binary.

## 3. Where things go

- Flatpak deployments live where Flatpak puts them. Start reads the installation selected by
  `XDG_DATA_HOME`, launches with `flatpak run`, reveals the deployment and asks Flatpak to remove it.
- A folder copy is a `suite.app.json` beside an executable you built or placed. Start records it in
  `installs.json` under `~/.config/suite/start/` and offers Open, Reveal and Forget.
- Start's own records are `installs.json` in `~/.config/suite/start/`, which the window and the
  `suite-start` CLI both read. `SUITE_START_REGISTRY` can name another file.
- Documents stay in `~/Documents/Suite/<App>`. Start never opens or edits them.

**Uninstall** on a Flatpak card asks Flatpak to remove the deployment. **Forget** on a placed copy
removes the record only. A pre-release asks separately whether to delete its channel's data in
`~/Documents/Suite Slop/<App>`; the stable folder is never inside that path.

## 4. What is published today

Canvas, Planner, Budget, Help, Start and Sync are Flatpaks on the signed remote. A fresh install
probes the `suite` remote first and then `suite-local`. An installed deployment is compared with its
own origin, so a copy from `suite-local` is not measured against the public `suite` store.

## 5. If something goes wrong

- **`flatpak` cannot find the app.** Check the remote with `flatpak remotes`; the store name is
  `suite` or `suite-local`, and `flatpak remote-ls suite` lists what it carries.
- **The card says no release found.** The remote is reachable but publishes no ref for that app yet.
- **The app is invisible in a tool-launched session.** Start reads the Flatpak installation selected
  by `XDG_DATA_HOME`; run with `XDG_DATA_HOME=$HOME/.local/share` to see the real user installation.
- **The store's summary is not signed.** Add the remote with the store's public key as
  [Packaging channels](../../../../docs/reference/packaging-channels.md#flatpak) describes; a remote
  added with `--no-gpg-verify` is for local testing only.

The relay is the sixth Flatpak, `run.suite.sync`: a tray app on a desktop, and the same install as the
headless relay on a machine with no display. Start's Sync tab detects it, installs it from the store,
and opens it; the tray app then runs the relay and shows its own address, relay code and fingerprint.
See [Leave a relay running](../../../sync/docs/how-to/relay.md).
