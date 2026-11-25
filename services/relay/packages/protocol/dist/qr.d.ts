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
export declare function qrMatrix(text: string, errorCorrection?: QrErrorCorrection): QrMatrix;
export declare function qrSvg(text: string, options?: QrSvgOptions): string;
//# sourceMappingURL=qr.d.ts.map