#!/usr/bin/env python3
"""Regenerate `src/appIcons.ts` and `build/app-icons/` from each app's own artwork.

Two sizes of the same picture, for two different readers:

- **64px data URIs** (`src/appIcons.ts`) are what a card in the hub draws. They ride in the
  source file so a card needs no new protocol path and no CSP change.
- **256px PNGs** (`build/app-icons/<id>.png`) are what a menu entry points at. `Icon=` names
  a theme icon, so the file has to be a real one in the hicolor theme at the size its folder
  claims — 256 into `256x256/apps`, not the 1024 source scaled by whoever reads it.

Both come from the same render, so a card, a window and a menu entry cannot drift apart.

The glyph is white on the hub's ink tile. A light theme flips the tile and the glyph together
with a CSS invert, which is why every source here must be a single-colour glyph on a
transparent field; the Help and Sync marks live under `build/app-icons/sources/`.

    python3 apps/start/scripts/make-app-icons.py

Needs Node with `sharp` and Pillow.
"""
import base64
import io
import subprocess
import tempfile
from pathlib import Path

INK = (22, 22, 26, 255)  # #16161a, the hub's own --ink
SIZE = 1024
CARD = 64
MENU = 256

here = Path(__file__).resolve().parent
hub = here.parent
repo = hub.parent.parent

ARTWORK = {
    "canvas": repo / "apps" / "canvas" / "desktop" / "build" / "icon.svg",
    "planner": repo / "apps" / "planner" / "resources" / "icon.svg",
    "budget": repo / "apps" / "budget" / "resources" / "icon.svg",
    "help": hub / "build" / "app-icons" / "sources" / "help.svg",
    "sync": hub / "build" / "app-icons" / "sources" / "sync.svg",
}


def render(name: str) -> bytes:
    path = ARTWORK[name]
    if not path.exists():
        raise SystemExit(f"missing artwork for {name}: {path}")
    source = path.read_text()
    # The marks added for Help and Sync use `currentColor`; the tile is dark, so the glyph
    # is painted white here.
    source = source.replace("currentColor", "#ffffff")
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as temp:
        temp.write(source)
        temporary = Path(temp.name)
    try:
        return subprocess.run(
            ["node", str(here / "render-svg.mjs"), str(temporary), str(SIZE)],
            check=True,
            capture_output=True,
        ).stdout
    finally:
        temporary.unlink(missing_ok=True)


menu_dir = hub / "build" / "app-icons"
menu_dir.mkdir(parents=True, exist_ok=True)

entries = []
for name in ARTWORK:
    png = render(name)

    from PIL import Image, ImageDraw

    glyph = Image.open(io.BytesIO(png)).convert("RGBA")
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    inset = int(SIZE * 0.055)
    draw.rounded_rectangle(
        [inset, inset, SIZE - inset, SIZE - inset], radius=int(SIZE * 0.22), fill=INK
    )
    target = int(SIZE * 0.56)
    canvas.alpha_composite(
        glyph.resize((target, target), Image.LANCZOS),
        ((SIZE - target) // 2, (SIZE - target) // 2),
    )

    menu_path = menu_dir / f"{name}.png"
    canvas.resize((MENU, MENU), Image.LANCZOS).save(menu_path, format="PNG")

    buffer = io.BytesIO()
    canvas.resize((CARD, CARD), Image.LANCZOS).save(buffer, format="PNG")
    entries.append((name, base64.b64encode(buffer.getvalue()).decode()))

lines = [
    "/**",
    " * The mark each app carries, as a data URI small enough to sit in a source file.",
    " *",
    " * Generated from each app's own `icon.svg` (and the Help/Sync sources beside this",
    " * script) — the app, the card and the menu entry show the same artwork. The tile is",
    " * ink and the glyph white; a light theme inverts both in CSS.",
    " * Regenerate with `python3 apps/start/scripts/make-app-icons.py`.",
    " */",
    "export const APP_ICONS: Readonly<Record<string, string>> = {",
]
lines.extend(
    f'  {name}:\n    "data:image/png;base64,{payload}",' for name, payload in entries
)
lines.extend(["};", ""])

out = hub / "src" / "appIcons.ts"
out.write_text("\n".join(lines))
# The generated file is part of the app, so let Biome make the final line breaks rather
# than guessing how it will treat a very long data URI.
subprocess.run(
    ["pnpm", "exec", "biome", "format", "--write", str(out)],
    cwd=hub,
    check=True,
    capture_output=True,
)
print(f"wrote {out} ({out.stat().st_size} bytes)")
print(f"wrote {menu_dir} ({len(entries)} icons at {MENU}px)")
