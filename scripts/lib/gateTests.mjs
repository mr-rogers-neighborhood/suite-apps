/**
 * The gate's script tests, discovered from the workdir being gated.
 *
 * The directory is the owner: adding `scripts/foo.test.mjs` makes the gate run
 * it with no edit to `gate.mjs`, and removing one removes it. `--fresh` passes
 * the export directory, so the same discovery sees the commit's files rather
 * than the working tree's.
 *
 * Only top-level `scripts/*.test.mjs` are discovered. A helper under
 * `scripts/lib/` is covered by the test that exercises it, not by a second
 * list here.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Every `scripts/*.test.mjs` under `root`, sorted for a stable command line. */
export function discoverScriptTests(root) {
  return readdirSync(join(root, "scripts"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => `scripts/${entry.name}`)
    .sort();
}
