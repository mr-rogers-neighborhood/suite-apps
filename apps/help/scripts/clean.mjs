#!/usr/bin/env node
/** Remove generated content and build output for Suite Help. */
import { rm } from "node:fs/promises";

await Promise.all([
  rm("out", { recursive: true, force: true }),
  rm("release", { recursive: true, force: true }),
  rm(".generated", { recursive: true, force: true }),
  rm(".source", { recursive: true, force: true }),
  rm("public/data", { recursive: true, force: true }),
]);

process.stdout.write("cleaned apps/help: out, release, .generated, .source, public/data\n");
