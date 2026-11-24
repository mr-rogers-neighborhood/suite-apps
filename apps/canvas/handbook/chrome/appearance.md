---
title: Appearance
description: "The host owns the theme; the reader owns density, canvas and radius."
order: 70
targets: []
---

The theme belongs to the host: **View → Theme** in Suite Shell, or **Settings** in Suite Go,
chooses Suite, Warm or Solarized, and **View → Light / Dark / Follow the system** says how bright
to draw it. Every open pack follows immediately, and a pack installed later opens in the same
theme. Canvas does not offer a second control and does not remember a choice of its own.

What remains here lives in **Settings**, which the command palette opens:

- **Density** — compact reduces the padding inside a card body, so more cards fit on one screen.
- **Canvas** — plain hides the dot grid.
- **Card radius** — one variable, and a card's own stored radius still wins.
- **Motion** — a preference the interface honours rather than a switch that only its own animations
  read.
- **The workspace palette** — the swatches everything else chooses from. This one is document data,
  so it is shared; the rest is this device.

None of the device settings sync, by design: they change how this screen draws, never what a peer
sees.
