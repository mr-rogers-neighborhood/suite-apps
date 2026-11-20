#!/usr/bin/env node
/**
 * Build Planner's renderer, add the pack bridge prelude, and sign the result.
 *
 *   pnpm planner:pack [--key <base64>] [--out .dev/planner.pack]
 *
 * The private key follows the existing rule: it is never in this repository. `SUITE_PACK_KEY` or
 * `--key` supplies it; `apps/go/.dev/suite-pack-key` is a local convenience for a development key
 * (that directory is ignored). The public half is `PACK_PUBLIC_KEY` in `src/host/packs.ts`.
 *
 * The entry page is written here rather than committed: its script name carries Vite's content
 * hash, and its CSP is the pack's own network seal, which the installer verifies.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(APP_DIR, "planner-dist");
const DEV_DIR = join(APP_DIR, ".dev");

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const id = arg("id") ?? "planner";
const name = arg("name") ?? "Planner";
const version = arg("version") ?? "0.1.0";
const out = arg("out") ?? join(DEV_DIR, `${id}.pack`);

function localKey() {
  const path = join(DEV_DIR, "suite-pack-key");
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trim().split(/\r?\n/u)[0];
}

const key = arg("key") ?? process.env.SUITE_PACK_KEY ?? localKey();

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? APP_DIR,
      env: process.env,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
    });
  });
}

/**
 * Rewrite Vite's generated page around the prelude.
 *
 * `planner.vite.config.ts` builds Planner's own `index.html`; the pack needs the same hashed
 * script, but with the prelude in front of it and a CSP the installer accepts. Two directives are
 * required and both are literal: `default-src 'self'` and `connect-src 'self'` (Loro fetches its
 * own wasm, so `'none'` would blank the frame).
 */
function rewriteEntry() {
  const built = readFileSync(join(DIST, "index.html"), "utf8");
  const script = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/iu.exec(built)?.[1];
  const stylesheet = /<link\b[^>]*\brel="stylesheet"[^>]*>/iu.exec(built)?.[0];

  if (script === undefined) {
    throw new Error("Planner's build produced no module script; the pack entry would be blank.");
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';"
    />
    <title>Suite Planner</title>
    ${stylesheet === undefined ? "" : `${stylesheet}\n    `}<script type="module" src="./prelude.js"></script>
    <script type="module" src="${script}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

  writeFileSync(join(DIST, "index.html"), html);
}

mkdirSync(DEV_DIR, { recursive: true });

// `pack.mjs` imports the built contract, so the contract goes first. `planner:build` then empties
// and fills `planner-dist`, and the prelude build adds one file without clearing it.
await run("pnpm", ["--filter", "@suite/go", "build"]);
await run("pnpm", ["--filter", "@suite/go-app", "planner:build"]);
await run("pnpm", [
  "--filter",
  "@suite/go-app",
  "exec",
  "vite",
  "build",
  "--config",
  "prelude.vite.config.ts",
]);
rewriteEntry();

if (!key) {
  console.error(
    "No signing key. Pass --key <base64>, set SUITE_PACK_KEY, or put a development key in " +
      "apps/go/.dev/suite-pack-key.\n" +
      "Generate one with `pnpm pack:keygen`; the public half goes into PACK_PUBLIC_KEY.",
  );
  process.exit(1);
}

await run("node", [
  "scripts/pack.mjs",
  "--dir",
  DIST,
  "--id",
  id,
  "--name",
  name,
  "--version",
  version,
  "--entry",
  "index.html",
  "--capabilities",
  "documents,recents",
  "--key",
  key,
  "--out",
  out,
]);
