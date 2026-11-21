import { readFile } from "node:fs/promises";
import sharp from "sharp";

/**
 * Rasterise one of the app marks for `make-app-icons.py`.
 *
 * `sharp` bundles librsvg, so the glyph is the SVG and not a placeholder from a
 * system renderer that may have no SVG delegate. The tile and the compositing stay
 * in the Python script; this only turns a path into a transparent PNG.
 *
 *   node apps/start/scripts/render-svg.mjs <source.svg> [size]
 */
const [, , input, rawSize] = process.argv;
if (input === undefined) {
  process.stderr.write("usage: render-svg.mjs <source.svg> [size]\n");
  process.exit(2);
}
const size = Number(rawSize ?? 1024);
const source = (await readFile(input, "utf8")).replaceAll("currentColor", "#ffffff");
const png = await sharp(Buffer.from(source), { density: 384 })
  .resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
process.stdout.write(png);
