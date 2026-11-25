# 2. Make a first workspace

This tutorial uses Canvas, the most developed app in the suite. It ends with a workspace containing a
card, a second board, and an exported copy.

## Install Canvas

Canvas is a frozen Flatpak, so install it from the signed remote:

```sh
flatpak install --user suite run.suite.canvas
```

Flatpak writes the menu entry, so Canvas opens without a hub. If the app later becomes a pack, install
it from the host's catalogue instead.

## Create a workspace

Canvas opens on its launcher. Choose **New workspace** and give it a name. The file is created in
`~/Documents/Suite/Canvas`; that file is the document, not a cache.

The workspace opens on its first board.

## Add a card

Use the library dock at the bottom of the window:

1. Choose **New card** (or **Note** for a text card).
2. Type a title. The title is the card's identity on every board.
3. Add a sentence in the body.

The card now exists in the workspace. The board shows a placement of it; the card is not owned by the
board.

## Make a second board

1. Use the board tabs at the top and add a board.
2. Place the same card on the new board from the library.

Edit the card on either board. The other board shows the same edit, because both boards are views of
one card.

## Keep a copy

Open the workspace menu and export a readable copy, or copy the `.canvas` file itself. The file is
self-contained, including images used in cards.

## What you have

- One `.canvas` file you own.
- Two boards that show the same card.
- A readable export or a copy that can be restored.

[Back up and restore](../how-to/back-up-and-restore.md) covers the copy in more detail, and
[Sync two devices](03-sync-two-devices.md) adds a second machine.
