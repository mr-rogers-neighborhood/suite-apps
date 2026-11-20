#!/usr/bin/env node
/**
 * Prove the released artifact actually serves the protocol.
 *
 *   node scripts/verify-relay.mjs                        # verify dist/release
 *   node scripts/verify-relay.mjs --dir /opt/suite-sync  # verify an installed tree
 *
 * This is deliberately not a unit test. A unit test calls `createSyncServer` in the same process,
 * which cannot catch the failures that matter for distribution: a missing runtime dependency in the
 * deploy, a `package.json` that did not travel, an entry point that is not executable, a CLI that
 * exits instead of listening.
 *
 * What it proves: the artifact unpacks, starts with no display, answers `/health`, and accepts a
 * `join` from two independent devices. What it does not prove: a workspace converging. That is
 * covered by `packages/host/src/server.test.ts` (two peers through the real server in-process) and
 * by `suite-dev/e2e/tests/sync-collab.spec.ts` (two Canvas windows). Saying which is which is the
 * point — a verification script that overstates itself is worse than none.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

function log(message) {
  console.log(`verify-relay: ${message}`);
}

function fail(message) {
  console.error(`verify-relay: FAIL ${message}`);
  process.exit(1);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

const work = mkdtempSync(join(tmpdir(), "suite-relay-verify-"));
let child = null;

function cleanup() {
  if (child !== null && child.exitCode === null) child.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
}
process.on("exit", cleanup);

/** The installed tree: either given, or whatever the last release produced, unpacked. */
async function installedTree() {
  const dir = arg("dir");
  if (dir !== undefined) {
    const resolved = resolve(dir);
    if (!existsSync(join(resolved, "dist/cli.js"))) fail(`${resolved} has no dist/cli.js`);
    log(`using installed tree ${resolved}`);
    return resolved;
  }

  const releaseDir = resolve(arg("release") ?? join(ROOT, "dist/release"));
  const tarballs = existsSync(releaseDir)
    ? readdirSync(releaseDir).filter((name) => name.endsWith(".tar.gz"))
    : [];
  if (tarballs.length === 0)
    fail(`no artifact in ${releaseDir}; run node scripts/release.mjs first`);

  // The newest artifact, if several are lying around.
  const tarball = join(releaseDir, tarballs.sort().at(-1));
  log(`unpacking ${tarball}`);
  await run("tar", ["-xzf", tarball, "-C", work]);
  const extracted = join(work, "suite-sync");
  if (!existsSync(join(extracted, "dist/cli.js")))
    fail("the artifact did not unpack to dist/cli.js");
  return extracted;
}

/** A WebSocket that answers what it was asked, with a hard deadline. */
function connect(url, timeoutMs = 5000) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no answer from ${url} within ${timeoutMs}ms`));
    }, timeoutMs);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`connection to ${url} failed`));
    });
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolveSocket(socket);
    });
  });
}

function ask(socket, message, timeoutMs = 5000) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error("no reply")), timeoutMs);
    const onMessage = (event) => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolveMessage(JSON.parse(String(event.data)));
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify(message));
  });
}

const workspaceId = "a".repeat(64);

function joinMessage(device, name) {
  return {
    type: "join",
    protocolVersion: 3,
    workspaceId,
    deviceId: device.deviceId,
    publicKey: `public-key-of-${name}`,
    name,
  };
}

async function main() {
  const tree = await installedTree();
  const port = await freePort();
  const store = join(work, "store");

  log(`starting ${tree} on 127.0.0.1:${port}`);
  child = spawn(
    process.execPath,
    [
      join(tree, "dist/cli.js"),
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--store",
      store,
      "--trust-all",
    ],
    { cwd: tree, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  // Wait for the line the CLI prints when it is actually listening.
  const deadline = Date.now() + 10_000;
  while (!stdout.includes("listening on")) {
    if (child.exitCode !== null) fail(`the relay exited ${child.exitCode}: ${stderr.trim()}`);
    if (Date.now() > deadline) fail(`the relay never said it was listening: ${stderr.trim()}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  const listening = /listening on (ws:\/\/\S+)/u.exec(stdout)?.[1] ?? `ws://127.0.0.1:${port}/sync`;
  log(`listening at ${listening}`);

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  if (health.ok !== true) fail(`/health did not report ok: ${JSON.stringify(health)}`);
  log(`/health ok (${health.workspaces} workspaces, ${health.clients} clients)`);

  const laptop = await connect(listening);
  const phone = await connect(listening);
  try {
    const laptopReply = await ask(laptop, joinMessage({ deviceId: "b".repeat(64) }, "laptop"));
    const phoneReply = await ask(phone, joinMessage({ deviceId: "c".repeat(64) }, "phone"));
    if (laptopReply.type === "rejected") fail(`the laptop was refused: ${laptopReply.reason}`);
    if (phoneReply.type === "rejected") fail(`the phone was refused: ${phoneReply.reason}`);
    log(`two devices joined (${laptopReply.type}, ${phoneReply.type})`);
  } finally {
    laptop.close();
    phone.close();
  }

  log("PASS: the artifact installs, runs headless, and accepts two devices");
  log("not covered here: workspace convergence — see packages/host/src/server.test.ts");
}

try {
  await main();
} finally {
  // The child keeps the event loop alive through its stdio pipes, so an explicit exit is the only
  // way a script whose whole job is to start and stop something ends.
  if (child !== null && child.exitCode === null) child.kill("SIGTERM");
  process.exit(process.exitCode ?? 0);
}
