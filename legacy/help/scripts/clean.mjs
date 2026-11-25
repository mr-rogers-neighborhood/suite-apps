#!/usr/bin/env node
/** Remove generated content and build output for Suite Help. */
import { rm } from "node:fs/promises";

await Promise.all([
  rm("out", { recursive: true, force: true }),
  rm("release", { recursive: true, force: true }),
  rm(".source", { recursive: true, force: true }),
  rm("../../packs/help/.dev", { recursive: true, force: true }),
  rm("../../packs/help/.generated", { recursive: true, force: true }),
  rm("../../packs/help/public/data", { recursive: true, force: true }),
]);

process.stdout.write(
  "cleaned legacy/help and packs/help: out, release, .dev, .generated, .source, public/data\n",
);
