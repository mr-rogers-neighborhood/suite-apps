import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(packageRoot, "dist", "fixtures"), { recursive: true });
await copyFile(
  join(packageRoot, "src", "fixtures", "home.screen.json"),
  join(packageRoot, "dist", "fixtures", "home.screen.json"),
);
