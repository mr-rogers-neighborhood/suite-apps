# Packaging channels

The suite ships the same applications through more than one channel. The channels differ in **who
owns the installed files**, and that decides who may update them.

| Form | Who owns the files | Updates arrive by | Root |
| --- | --- | --- | --- |
| AppImage | the user, under `~/Applications` | Suite Start, from the signed feed | no |
| Arch package | root, under `/opt` | the package manager | yes |
| Flatpak | Flatpak, inside a sandbox | an OSTree remote | no for `--user` |
| deb / rpm / snap | root, or the store | the package manager or store | yes |

## The rule

**Suite Start can only replace a file it can write.**

An AppImage under `~/Applications/Suite/<App>/<version>/` belongs to the person who installed it, so
Start can download the next version and put it there. A package under `/usr` or `/opt` belongs to the
package manager, so Start cannot update it.

That is why the suite ships two different things:

- **The hub is packaged.** Suite Start does not update itself; its own row links to the release page.
  Root ownership costs nothing and buys a menu entry, a registered `suite://` handler and no FUSE.
- **The apps are AppImages.** Start installs, updates and removes them, which is the update path a
  person can rehearse.

## AppImage

The AppImage is the default for every distribution except Arch. The release carries the image and
`latest-linux.yml`, which names the file and its SHA-512. Start verifies the checksum against the
manifest before placing an app.

An AppImage needs FUSE 2; many distributions no longer install it. `--appimage-extract-and-run`
works without FUSE, and an unpacked build keeps the Electron sandbox. The AppImage itself may need
`--no-sandbox` because `chrome-sandbox` cannot be setuid on a read-only mount.

Details and the checksum step are in
[Installing Suite Start](../../apps/start/docs/how-to/install.md).

## Arch package

`packaging/arch/PKGBUILD` builds `suite-start-bin` by repackaging the published AppImage,
so the package and the feed cannot describe different releases. It extracts with
`--appimage-extract`, which removes the FUSE dependency.

The hub is the only app packaged this way.

## Flatpak

Flatpak is a second channel, currently proven on Canvas. The manifest is
`packaging/flatpak/run.suite.canvas.yml`, and the build uses zypak from the Electron base app.

```sh
node scripts/flatpak.mjs              # package, build, publish, install
node scripts/flatpak.mjs --no-build   # reuse release/linux-unpacked
flatpak run run.suite.canvas
```

The script exports to `~/suite-flatpak/repo`, adds it as the user remote `suite-local`, and installs
from that remote, so `flatpak update` is the real update path.

`scripts/store-key.sh` makes the store's signing key once. When it has run, `flatpak.mjs` signs the
repository summary, exports the public key beside the fingerprint in `~/suite-flatpak`, and adds the
remote with `--gpg-import`, so every later `flatpak install` and `flatpak update` verifies what it
downloads. A remote that an earlier run added unsigned is switched to verification on the next run.
Without a key the remote is added with `--no-gpg-verify`, which is for local testing only, and the
script says so.

Start lists Flatpak installs, launches them through `flatpak run`, asks Flatpak to remove one, and —
when the store offers the app — asks Flatpak to install it or to replace a deployment whose commit is
behind. Start reads the commits and never writes a deployment itself. The signed local store has been
exercised end to end: a second published commit turns the card into `update available`, and **Update**
returns it to `Flatpak` with the new commit deployed. The hub is still an AppImage and an Arch package;
packaging it as a Flatpak is a separate decision.

`XDG_DATA_HOME` decides which Flatpak installation is visible. A tool that points it at a per-session
directory, such as Orca, hides the real user installation; run with
`XDG_DATA_HOME=$HOME/.local/share` to see it.

## Platforms

Linux is the only platform with published builds. macOS and Windows are configured but have no
signing identity, so there is nothing to download.

## Update feeds

Each app declares a feed. Start asks every feed what version it has and shows one of four states: not
installed, no release found, an update available, or up to date. The artifact is the one named by the
verified manifest, and its sha512 is checked before installation.

A single monorepo `releases/latest` cannot serve several different `latest-linux.yml` files. Per-app
feeds need per-app tags or a static feed host; until then the app repositories' releases are the last
published feed, not a live pipeline.
