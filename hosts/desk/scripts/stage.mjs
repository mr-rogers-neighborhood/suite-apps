import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy what `tsc` does not.
 *
 * The preloads are CommonJS because a sandboxed preload has no ESM. The chrome
 * page is HTML, CSS and one plain module; its tab strip is a React island built
 * separately by Vite into the same directory. Packs live in `packs/` as unsigned
 * development directories; they are not packaged and are not copied into `dist/`.
 */
const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, "..");

mkdirSync(join(app, "dist", "preload"), { recursive: true });
copyFileSync(join(app, "src", "preload", "chrome.cjs"), join(app, "dist", "preload", "chrome.cjs"));
copyFileSync(join(app, "src", "preload", "pack.cjs"), join(app, "dist", "preload", "pack.cjs"));
const renderer = join(app, "src", "renderer");
mkdirSync(join(app, "dist", "renderer"), { recursive: true });
// Copy the whole chrome page except the island's sources; Vite writes those as
// `tab-bar.js` and `tab-bar.css` straight into `dist/renderer`. A hand-written file list
// silently dropped a new asset before, so anything outside `react/` comes along.
cpSync(renderer, join(app, "dist", "renderer"), {
  recursive: true,
  filter: (source) => relative(renderer, source).split(/[\\/]/u)[0] !== "react",
});
