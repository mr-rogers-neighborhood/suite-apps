# Packaging: the forms, and which one is for what

A note for anyone arriving from web development, where "deploy" means one thing. On the desktop it
means several, and they differ in **who owns the file on disk** — which decides everything else,
including who is allowed to update it.

| Form | Closest web analogy | Who owns the installed files | Updates arrive by | Root needed |
| --- | --- | --- | --- | --- |
| **AppImage** | a self-contained static build you run with `./` | the user, in `~/Applications` | Start, from the signed feed | no |
| **Arch package** | deploying into the host's package registry | **root**, under `/opt` | the package manager | yes |
| **Flatpak** | a container runtime for desktop apps | Flatpak (user or system), inside a sandbox | an OSTree remote | no for `--user`, yes for `--system` |

The three apps and the hub ship as AppImage and Flatpak; only the hub has the Arch package. `deb` is
no longer a configured target, and `rpm` and `snap` were never built.

## The rule this repository is built on

**Start can only replace a file it can write, or ask the writer that owns it.**

An AppImage in `~/Applications/Suite/<App>/<version>/` is owned by the person who ran the installer, so
Start — running as that person — can download the next version and put it there. That is the whole
update model: one process decides, and it is the window you are looking at.

A distro package is root-owned. Start cannot write to `/usr`, so it cannot update what the package
manager installed. A Flatpak deployment belongs to Flatpak, so Start asks it. That is not a limitation
to work around; it is why each form has one writer:

- **The hub is packaged.** An AppImage hub does not update itself (its row links to the release page),
  and an Arch hub belongs to the package manager; a Flatpak hub is updated by Flatpak. Packaging buys
  a menu entry, a registered `suite://` handler and no FUSE.
- **The apps are installed by a writer Start can ask.** Start updates the AppImages it placed and asks
  Flatpak to update a deployment. Either way the update path is something a person can rehearse.

## The Arch package

`apps/start/packaging/arch/PKGBUILD` builds `suite-start-bin`. It **repackages the published
AppImage** rather than rebuilding the app, so the package and the signed feed can never describe
different releases.

```sh
cd apps/start/packaging/arch
makepkg --nocheck --nodeps            # downloads the pinned AppImage, verifies its sha256, builds
sudo pacman -U suite-start-bin-<version>-1-x86_64.pkg.tar.zst
```

What `package()` does, and why each part:

- `--appimage-extract` into `/opt/suite-start` — no mounting, so **no `fuse2` dependency**. The hub
  starts on a machine that has never heard of FUSE.
- Every directory it installs is normalised to **0755**. This is not cosmetic: the image's own
  directories are 0700, `cp -a` reproduces that faithfully, and a root-owned directory a user cannot
  traverse makes every file inside it report as missing. That shipped once — 0.3.1 installed and then
  said "Could not find the program '/opt/suite-start/suite-start'" — and `release.mjs` now reads the
  built archive back and refuses one whose `opt/` directories are not world-executable.
- A `.desktop` of its own, with `Exec=/opt/suite-start/suite-start %U` and
  `MimeType=x-scheme-handler/suite;`, so links open the hub and the window is associated with its own
  entry.
- The icons the AppImage already carries, installed under `/usr/share/icons/hicolor/`.
- `chrome-sandbox` set to `4755` root-owned, which is what lets Electron's renderer sandbox work
  properly. The AppImage cannot do this — a package can, because it installs as root.

The `-bin` suffix is the Arch convention for a package that repackages an upstream binary rather than
compiling one. It is not in any index: it is attached to the GitHub release beside the AppImage.

### Why not electron-builder's `pacman` target

It exists (`--linux pacman`) and it runs, off the `fpm` electron-builder downloads for you. What it
produced here:

| fpm wrote                             | Why it fails                                                 |
| ------------------------------------- | ------------------------------------------------------------ |
| `pkgname = Suite Start`               | Package names cannot contain spaces; `pacman -U` refuses it. |
| `Depends On: … http-parser …`         | Arch does not ship `http-parser`.                            |
| `Depends On: libappindicator-gtk3`    | Arch calls it `libappindicator`.                             |
| Installs to `/opt/Suite Start/`       | The space is in every path in the tree.                      |
| `.INSTALL` runs `update-alternatives` | A Debian-ism; falls through to a symlink.                    |

`fpm` is a good general packager; it is not an Arch packager. Forty lines of PKGBUILD is the honest
answer, and `makepkg` is the tool an Arch user already trusts.

### Flatpak for the hub

The hub ships as `run.suite.start` too, built from the same unpacked tree with
`node scripts/flatpak.mjs --app start`. It uses the same zypak wrapper as the apps, and its exported
desktop entry registers `x-scheme-handler/suite`.

A sandboxed package manager needs a wider door. The manifest grants the host Flatpak service
(`org.freedesktop.Flatpak`, used with `flatpak-spawn --host`) and the folders Start owns: the
applications root, menu entries, icons, suite data and config, and the documents tree read-only. The
host service is effectively host command execution, and it is the trade that lets the hub manage
Flatpaks from a sandbox. The one-writer rule is unchanged: Flatpak writes the hub's own deployment.

Each app can ship as a Flatpak beside its AppImage (Canvas first; see `packaging/flatpak/`). Start
treats an installed Flatpak as a first-class app: it reads `flatpak list`, starts it with `flatpak
run`, reveals the deployment, asks Flatpak to remove it, and — when the store offers the app — asks
Flatpak to install it or to replace a deployment whose commit is behind (`src/flatpak.ts`). Flatpak
stays the writer; Start reads the deployed commit and the published one and never swaps a deployment
itself. [Packaging channels](../../../../docs/reference/packaging-channels.md#flatpak) owns the full
permission list and the remote.

## Cutting a release that includes the package

`node scripts/release.mjs start --publish` from the repository root. It writes a PKGBUILD whose
`pkgver`, `source` line and `sha256sums` come from the artifact it just built — a stale checksum would
fail makepkg, which is the point — builds the package, and uploads it with the AppImage, the feed and
the signature.
Without `--publish` the same command is a dry run; `--verify` reads the published feed back. The tag
defaults to `start-v<version>`, and `--tag` still overrides it. The Flatpak is a separate build:
`node scripts/flatpak.mjs --app start` publishes it to the store.

An app without an Arch package, or a machine without `makepkg`, skips the package with a note: only
the hub has one.
