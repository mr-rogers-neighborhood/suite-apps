#!/usr/bin/env node
/**
 * Build Planner's renderer, add the pack bridge prelude, and sign the result.
 *
 *   pnpm planner:pack [--key <base64>] [--out .dev/planner.pack]
 *
 * The private key follows the existing rule: it is never in this repository. `SUITE_PACK_KEY` or
 * `--key` supplies it; `~/.config/suite/keys/pack-key` is where `pnpm keys generate pack` puts it
 * (or wherever `SUITE_KEYS_DIR` points). The public half is `SUITE_PACK_PUBLIC_KEY` in
 * `packages/pack/src/pinnedKey.ts`; `PACK_PUBLIC_KEY` in `src/host/packs.ts` re-exports it, so a
 * rotation edits the shared pin and rebuilds every pack. `pnpm keys status` says whether the two on
 * this machine agree.
 *
 * The entry page is written here rather than committed: its script name carries Vite's content
 * hash, and its CSP is the pack's own network seal, which the installer verifies.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keyPath, readKey } from "../../../scripts/lib/keys.mjs";

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

/**
 * The pack's declaration, shared with the test that proves the frame accepts it.
 *
 * The capabilities are not repeated here: `planner/pack.json` is the one place
 * that says what this pack asks the container for, so the built manifest and the
 * fixture that exercises the bridge cannot drift. The prelude calls `host.files`
 * for import and export, so `files` has to be in this list and the contract has
 * to be the version that serves it.
 */
const DECLARATION_PATH = new URL("../planner/pack.json", import.meta.url);
const declaration = JSON.parse(readFileSync(DECLARATION_PATH, "utf8"));
if (!Array.isArray(declaration.capabilities) || declaration.capabilities.length === 0) {
  throw new Error("planner/pack.json must list at least one capability.");
}
if (!Number.isInteger(declaration.contractVersion) || declaration.contractVersion < 1) {
  throw new Error("planner/pack.json must name a positive integer contractVersion.");
}
if (!declaration.capabilities.includes("files")) {
  throw new Error(
    "planner/pack.json must declare files: the prelude imports and exports through it.",
  );
}

/**
 * The signing key, from the one home secrets have.
 *
 * It used to be `hosts/go/.dev/suite-pack-key`, which is the scratch directory the build replaces:
 * a cleanup took the only copy with it. Nothing durable lives there now. `pnpm keys status`
 * reports whether this key is the one `SUITE_PACK_PUBLIC_KEY` trusts.
 */
function localKey() {
  return readKey("pack") ?? undefined;
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
    "No signing key. Pass --key <base64>, set SUITE_PACK_KEY, or run `pnpm keys generate pack`.\n" +
      `That command writes the key to ${keyPath("pack")}.\n` +
      "A pack that is not signed is not installable, by design.",
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
  declaration.capabilities.join(","),
  "--contract",
  String(declaration.contractVersion),
  "--key",
  key,
  "--out",
  out,
]);
