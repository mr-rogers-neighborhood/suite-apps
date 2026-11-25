import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy what `tsc` does not.
 *
 * The preloads are CommonJS because a sandboxed preload has no ESM. The chrome
 * page is plain HTML, CSS and one module, so neither is compiled. Packs live in
 * `packs/` as unsigned development directories; they are not packaged and are
 * not copied into `dist/`.
 */
const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, "..");

mkdirSync(join(app, "dist", "preload"), { recursive: true });
copyFileSync(join(app, "src", "preload", "chrome.cjs"), join(app, "dist", "preload", "chrome.cjs"));
copyFileSync(join(app, "src", "preload", "pack.cjs"), join(app, "dist", "preload", "pack.cjs"));
cpSync(join(app, "src", "renderer"), join(app, "dist", "renderer"), { recursive: true });
