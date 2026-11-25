import qrcode from "qrcode-generator";

/**
 * QR rendering for a relay code.
 *
 * The matrix is returned as rows of `1` and `0` rather than a canvas or an image,
 * so the same function serves the relay's HTML page and Start's plain renderer.
 * `qrcode-generator` is the dependency: zero transitive packages, MIT, and small
 * enough that the console needs no bundler and no React.
 */

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  /** Modules per side, quiet zone excluded. */
  readonly size: number;
  /** `size` strings of `size` characters, `1` for a dark module. */
  readonly rows: readonly string[];
}

export interface QrSvgOptions {
  /** Quiet-zone modules around the code. Four is the usual scanner margin. */
  readonly border?: number;
  /** Pixels per module in the rendered `width` and `height`. */
  readonly scale?: number;
  /** What the SVG says when it cannot be seen. */
  readonly label?: string;
}

export function qrMatrix(text: string, errorCorrection: QrErrorCorrection = "M"): QrMatrix {
  if (text.length === 0) throw new Error("a QR code needs something to say");
  const code = qrcode(0, errorCorrection);
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  const rows: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let line = "";
    for (let column = 0; column < size; column += 1) {
      line += code.isDark(row, column) ? "1" : "0";
    }
    rows.push(line);
  }
  return { size, rows };
}

export function qrSvg(text: string, options: QrSvgOptions = {}): string {
  const matrix = qrMatrix(text);
  const border = Math.max(0, Math.trunc(options.border ?? 4));
  const scale = Math.max(1, Math.trunc(options.scale ?? 4));
  const label = escapeAttribute(options.label ?? "Suite relay code");
  const dimension = matrix.size + border * 2;

  // One path, one rectangle per run of dark modules, keeps a 45×45 code small.
  const runs: string[] = [];
  matrix.rows.forEach((row, y) => {
    let x = 0;
    while (x < matrix.size) {
      if (row[x] !== "1") {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < matrix.size && row[end] === "1") end += 1;
      runs.push(`M${x + border} ${y + border}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension * scale}" ` +
    `height="${dimension * scale}" viewBox="0 0 ${dimension} ${dimension}" ` +
    `role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    `<rect width="${dimension}" height="${dimension}" fill="#fff"/>` +
    `<path d="${runs.join("")}" fill="#000"/>` +
    "</svg>"
  );
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
