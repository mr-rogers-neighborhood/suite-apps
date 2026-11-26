import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Storybook's Vitest plugin keeps its generated setup file in this cache. Adding a story to a
 * glob outside `packages/ui` can leave it pointing at a stale module, and the browser then
 * fails with "Failed to fetch dynamically imported module". A cold cache is cheap next to a
 * confusing failure; the dev server keeps its own warm cache.
 */
const here = dirname(fileURLToPath(import.meta.url));
rmSync(join(here, "..", "node_modules", ".cache", "storybook"), { recursive: true, force: true });
