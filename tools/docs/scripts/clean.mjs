#!/usr/bin/env node
/** Remove generated content and build output. */
import { rm } from "node:fs/promises";

await Promise.all([
  rm(".next", { recursive: true, force: true }),
  rm(".source", { recursive: true, force: true }),
  rm(".generated", { recursive: true, force: true }),
  rm("public/data", { recursive: true, force: true }),
]);

process.stdout.write("cleaned tools/docs: .next, .source, .generated, public/data\n");
