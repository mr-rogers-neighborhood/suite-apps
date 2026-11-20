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

`apps/start/packaging/arch/PKGBUILD` builds `suite-start-bin` by repackaging the
published AppImage, so the package and the feed cannot describe different releases. It extracts with
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
from that remote, so `flatpak update` is the real update path. The development repository is unsigned
and the remote is added with `--no-gpg-verify`; a published repository needs
`flatpak build-update-repo --gpg-sign` and a key the client already trusts.

Start lists Flatpak installs, launches them through `flatpak run`, and can ask Flatpak to remove one.
Start does not install Flatpaks yet, and the hub stays an unpacked install until it manages Flatpak
installs and updates end to end.

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
