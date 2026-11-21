# Installing Suite Start

Suite Start is the hub: one window that installs, updates and opens the other apps in the suite. It is
the only piece you fetch by hand — every other app arrives through it.

## 0. On Arch, use the package (shortest path)

The release also carries an Arch package, which installs the hub under `/opt` with a menu entry and
**no FUSE requirement at all**:

Open the [releases page](https://github.com/mr-rogers-neighborhood/suite-apps/releases) and choose
the newest `start-v…` release. Download `suite-start-bin-<version>-1-x86_64.pkg.tar.zst` from it,
then:

```sh
sudo pacman -U suite-start-bin-<version>-1-x86_64.pkg.tar.zst
```

The version in those names is whatever that release is called; the release page lists the exact file.

Then start **Suite Start** from your application menu, or run `suite-start`. A new hub version arrives
the same way: download the newer package from its release and `pacman -U` it. The hub cannot update
itself, and says so on its own row.

[Packaging: the forms, and which one is for what](package.md) explains why the hub is packaged while
the apps it installs come through Start or Flatpak.

## 0b. On a Flatpak desktop, use the store

Suite Start also ships as the stable Flatpak `run.suite.start`, beside Canvas, Planner and Budget.
Add the signed store remote as
[Packaging channels](../../../../docs/reference/packaging-channels.md#flatpak) describes, then:

```sh
flatpak install --user suite run.suite.start
flatpak run run.suite.start
```

A newer hub arrives with `flatpak update --user`, and the hub's own row offers **Update Start** when
the store publishes a newer commit.

## 1. Download (the AppImage)

Open the newest `start-v…` release on the
[releases page](https://github.com/mr-rogers-neighborhood/suite-apps/releases) and download:

- `suite-start-<version>-x86_64.AppImage` — the app, one file;
- `latest-linux.yml` — what the updater reads, and what you can check the file against.

Linux is the only platform with a published build. macOS and Windows are configured but have no
signing identity yet, so there is nothing to download for them.

## 2. Check the download (a minute, once)

The yml names the file and its SHA-512. Compare it before you run anything:

```sh
sha512sum suite-start-<version>-x86_64.AppImage
```

The value must match the `sha512:` beside the file name in `latest-linux.yml`. This is the same check
Start makes on every app it installs.

## 3. Make it runnable

```sh
chmod +x suite-start-<version>-x86_64.AppImage
```

An AppImage needs FUSE 2 to mount itself. Many distributions no longer install it by default, and
without it you get `dlopen(): error loading libfuse.so.2`. Two answers, either is fine:

```sh
# install FUSE 2
sudo pacman -S fuse2          # Arch
sudo apt install libfuse2     # Debian, Ubuntu
sudo dnf install fuse         # Fedora

# or run it without FUSE, which extracts and starts in one step
./suite-start-<version>-x86_64.AppImage --appimage-extract-and-run
```

## 4. Open it

```sh
./suite-start-<version>-x86_64.AppImage
```

You get one window with a card per app the suite offers:

| What the card says                           | What it means                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| **Install Suite Canvas**                     | A release is published and verified; one press downloads it.                   |
| **Not installed yet · from the store**       | A Flatpak store has it; one press asks Flatpak to install it.                  |
| **No release found**                         | Nothing is published for that app yet. The button appears when a version does. |
| `‹version›` **· up to date**                 | Installed, and the published version is the one you have.                      |
| `‹version›` **· newer version available**    | Installed, with **Update to …** as the main button.                            |
| `‹version›` **· Flatpak**                    | Flatpak installed it, and Flatpak is its update path.                          |
| `‹version›` **· Flatpak · update available** | The store publishes a different build; **Update** asks Flatpak to replace it.  |
| **slop** badge                               | A pre-release build. Its card names the risk and the separate data folder.     |
| **Switch to canary**                         | Moves the one pre-release install to another tier; it is not a second install. |

A download shows a bar **on the card**, in place of the button, and a failure says what went wrong in
the same place. An install through Flatpak shows **Installing…** there instead, because Flatpak does
not report a percentage. Nothing installs itself: Start reads a version when the window opens, and
fetches a file only when you press something.

Stable and one pre-release can sit side by side: they are two ids and two cards. Every pre-release
tier shares `run.suite.slop.<app>`, so there is one pre-release install, not one per tier. If the
store publishes another branch, the card offers **Switch to …** rather than a second Install; the
install and its `~/Documents/Suite Slop/<App>` data folder stay. The badge is text (`slop`, `canary`
or `beta`) so it survives a screenshot; the sentence under it names the risk and the removal path.

The last row is Start itself. An AppImage or Arch hub cannot replace its own running binary: a newer
release links to the release page or belongs to the package manager. A Flatpak hub's row offers
**Update Start** through Flatpak instead.

## 5. Where things go

- Installs: `~/Applications/Suite/<App>/<version>/` — the binary, a `suite.app.json` Start wrote for
  it, and nothing else. An update adds the new version, then removes the old one.
- Start's own records: `installs.json` in `~/.config/suite/start/`, which the window and the
  `suite-start` CLI both read. A pre-Flatpak build copies its old `userData` registry there once;
  `SUITE_START_REGISTRY` still names another file.
- Documents stay in `~/Documents/Suite/<App>`. Start never opens or edits them.

**Uninstall** on a card removes the versions Start placed, its menu entry and its install record;
documents are not touched. A pre-release asks separately whether to delete its channel's data in
`~/Documents/Suite Slop/<App>`; the stable folder is never inside that path.

## 6. What is published today

Canvas, Planner and Budget each have a published release, so each card offers **Install** and shows
the version its feed names. There is no app in the suite with an empty card today; a card that cannot
find a release says so rather than hiding.

## 7. If something goes wrong

- `libfuse.so.2` — see step 3; it is the most common first failure.
- "the manifest is not signed by the publisher" on a card — the feed it reads is not signed with the
  key Start has pinned. That is a refusal, not a bug, and nothing is downloaded.
- A card that never leaves "Not installed yet" after a press — the download failed; the sentence on
  the card is the reason, and the previous install (if any) is untouched.
