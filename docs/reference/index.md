---
audience: developer
---

# Reference

Facts to look up. These pages describe the repository as it is today.

| Page | Covers |
| --- | --- |
| [Repository layout](repo-layout.md) | Directories, workspace packages and who owns what |
| [Commands](commands.md) | The root gate, per-app checks and the toolchain |
| [Desktop proof](desktop-proof.md) | The `@proof` Playwright tag, runner command and where proof artifacts land |
| [Packaging channels](packaging-channels.md) | Flatpak and the Android APK, and who may update what |
| [Pack authoring](pack-authoring.md) | The layout, build and checks for a pack source under `packs/<app>/pack/` |
| [Pack readiness](pack-readiness.md) | The on-demand build, signature, install/remove and primary-path proof for every pack |
| [File formats](file-formats.md) | `.canvas`, `.planner`, `.budget`, sync workspaces and backups |
| [Environment](environment.md) | Variables that move data roots or configure sync |
| [Decisions](decisions.md) | The rules that shape the repository |
| [Menu bar](menu-bar.md) | The shared top bar: seven zones, the takeover rule and keyboard behaviour |
| [Bridges](bridges.md) | What each renderer's host bridge must provide |
| [Accessibility](accessibility/wcag-22-map.md) | The WCAG 2.2 criterion map and the manual testing protocol |
| [Glossary](glossary.md) | The words shared across apps: app, domain, pack, document, workspace |
| [Suite Help](help.md) | The documentation app: explorer, handbook and Flatpak packaging |
| [Status](status.md) | What works, per subsystem, and what is missing |
| [Agent skills](agent-skills.md) | Where skills live, how to author and prune them, and the current set |
| [Code review](code-review.md) | Native OCR on DeepRelay, the token budget and the fallback |
| [Ideas](ideas.md) | The planning tracker: Now, Next and Someday, each linked to the page that owns the fact |

Versions are not listed here. They live in `package.json` and each app's `CHANGELOG.md`.
