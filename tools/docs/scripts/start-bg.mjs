#!/usr/bin/env node
/** Start the docs dev server in the background and write a pid file. */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const devDir = join(root, ".dev");
const port = Number(process.env.DOCS_PORT ?? 3001);

async function listening() {
  const net = await import("node:net");
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

if (await listening()) {
  process.stdout.write(`docs already listening on http://localhost:${port}\n`);
  process.exit(0);
}

await mkdir(devDir, { recursive: true });
const logPath = join(devDir, "docs.log");
const out = openSync(logPath, "a");
const child = spawn("pnpm", ["--dir", "tools/docs", "dev"], {
  cwd: root,
  detached: true,
  stdio: ["ignore", out, out],
});
child.unref();
await writeFile(join(devDir, "docs.pid"), String(child.pid));

process.stdout.write(`docs dev started on http://localhost:${port} (pid ${child.pid})\n`);
process.stdout.write(`log: .dev/docs.log\n`);
