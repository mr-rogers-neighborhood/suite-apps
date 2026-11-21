#!/usr/bin/env node
/** Stop the docs dev server on the docs port, whatever started it. */
import { execFileSync } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.DOCS_PORT ?? 3001);
let stopped = false;

try {
  execFileSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
  stopped = true;
} catch {
  // `fuser` is the Linux path; fall back to `lsof` on macOS.
  try {
    const pids = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" }).trim();
    if (pids !== "") {
      for (const pid of pids.split(/\s+/)) process.kill(Number(pid), "SIGTERM");
      stopped = true;
    }
  } catch {
    // not listening
  }
}

async function listening() {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

if (stopped) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await listening())) break;
    await delay(100);
  }
}

process.stdout.write(stopped ? `stopped docs on :${port}\n` : `nothing listening on :${port}\n`);
