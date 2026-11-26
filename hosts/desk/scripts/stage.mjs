import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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
for (const file of ["index.html", "shell.js", "shell.css"]) {
  copyFileSync(join(renderer, file), join(app, "dist", "renderer", file));
}
