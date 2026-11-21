# Changelog

Written for people, not commits: what you can do now that you could not before, and what changed
underneath enough to matter.

Versions here are Planner's own, tagged `planner-v<version>`. The rules are in
[Version ownership](../../docs/how-to/package-and-release.md#version-ownership).

## [Unreleased]

No changes yet.

## [0.5.0] - 2026-11-21

### Added

- **Plan the whole week on one page.** A new surface beside Today shows seven day columns starting on
  the first day of your week, each with its scheduled tasks and a capacity meter that respects the
  day's own override. Drag a task to another day, or focus it and press Alt+← / Alt+→, with the row
  menu offering the same moves in words. Unfinished non-recurring work from before today waits in a
  labelled carry-over area until you move it, and nothing is rescheduled silently; a repeating task's
  occurrence stays on its series anchor.

## [0.4.0] - 2026-11-21

### Added

- **Task notes take formatting.** Paragraphs, headings, bold, italic, inline code, links and bullet
  or numbered lists edit in place from the task detail dialog, with a toolbar over the note instead
  of a plain textarea. The note is the task's Loro note root, so an edit lands in the document as you
  type and needs no save action. A note written before this release opens with its words and line
  breaks intact; an older build still reads the plain-text copy, so it does not see changes made in
  the rich note.

## [0.3.0] - 2026-11-20

### Added

- **Four more surfaces beside the day.** Projects with their open work, Tags with the tasks that
  carry them, Upcoming grouped by day, and a Focus view whose sessions keep running when you leave
  it. The rail lists each one; nothing is hidden behind a menu.
- **Plan the day and shut it down.** Rituals sets the day's intention and a capacity that the meter
  respects, then closes the day with a shutdown note; unfinished work is shown as carry-over and
  moves only when you choose it.
- **Edit a task without leaving the list.** Notes, checklist, recurrence, estimate, project, tags and
  times open from the row, and the row's reminder menu still works.
- **Share a workspace through a relay you run.** The sync pill opens a dialog that shares the open
  `.planner` file, makes a single-use invitation, joins from one, and leaves. The relay stores
  sealed frames it cannot read; the file, the keys and the document stay on the two machines. There
  is no TLS yet and the default address is loopback.

### Changed

- **One top bar, the same as Canvas and Budget.** The mark, workspace name, view menu, export and
  import, and the theme control ride in the shared bar. On a phone the plan keeps the width and
  navigation moves into the drawer.

## [0.2.4] - 2026-11-20

### Changed

- **Rebuilt to trust the rotated update key.** The app itself is unchanged; its binary now verifies
  the feed Suite Start reads with the current publishing key. An install that keeps the previous
  build will not see this release through its own updater, so Suite Start replaces it.
- **The feed is read from the repository's raw file host.** GitHub Pages needs Actions to build and
  Actions is unavailable, so the signed manifest is served from `main` directly.

## [0.2.2] - 2026-11-08

### Added

- A start screen, shown only on the run that creates the workspace. Planner used to invent a file
  and drop the person into a blank week with nothing saying where their work would go.

### Fixed

- An installed update now replaces a running Planner. It keeps a tray, so closing the window left
  the old process alive; the new binary then lost the single-instance lock and the old window came
  back, which made an update look like a no-op.
- A host that is not our Electron shell can boot the renderer again: `wasCreated` was a required
  bridge method, and a container handing over a document has no first run to report.

## [0.2.1] - 2026-11-07

### Changed

- The interface wears the Planner glyph now, on the suite's accent tile, instead of a gradient
  square. The glyph has shipped with the window icon all along; the interface could not use it
  because it was drawn white and vanished on a light page.
- **The theme control moved under the app name**, where it is on screen without scrolling. It
  was in the sidebar footer, which is where nobody looks for a setting that changes everything.

### Fixed

- The privacy claim uses the suite's shared sentence: "Local file. No account, no server, no
  telemetry."

## [0.2.0] - 2026-11-07

### Added

- **Three colour themes, each in light and dark.** Suite, Solarized in its two official variants,
  and Warm. The sidebar offers a Theme list and a Brightness toggle, and the choice is remembered.
  This is the first release where the app can be something other than dark.

### Changed

- The interface draws from the suite's shared palette, so a preset repaints every control. Money
  colours, the accent and the danger state all come from one place.

### Fixed

- A primary button's label was hardcoded white, which is unreadable on some presets.

## [0.1.2] - 2026-11-07

### Fixed

- The app's mark is where the package looks for it. 0.1.0 and 0.1.1 shipped Electron's default icon
  because the artwork was in `build/` and this app's build resources are `resources/`.

## [0.1.1] - 2026-11-07

### Added

- The app has its own icon, on the window and in the menu entry the system draws.

### Changed

- An update now arrives from Suite Start. An app the hub launched leaves its own update check
  alone, because two programs writing one binary is not a race worth having. A copy run from a
  folder keeps its own updater.
- The update report is written even on a first launch, so the hub can say "not checked" instead of
  showing an answer from whenever the app last ran.

### Fixed

- The artifact name carries no spaces, so the signed feed names a file that exists.

## [0.1.0] - 2026-11-06

### Added

- First packaged release: tasks, projects and a calendar in a file you own.
