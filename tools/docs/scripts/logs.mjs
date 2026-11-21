#!/usr/bin/env node
/** Follow the background dev log, creating it first so the shortcut never fails. */
import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const logPath = join(root, ".dev/docs.log");
await mkdir(join(root, ".dev"), { recursive: true });
await appendFile(logPath, "");

const child = spawn("tail", ["-f", logPath], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
