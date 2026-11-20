#!/usr/bin/env node
/**
 * Two devices, one workspace, one relay binary — and the document converges.
 *
 *   node scripts/verify-convergence.mjs
 *   node scripts/verify-convergence.mjs --cli ../apps/suite-sync/apps/server/dist/cli.js
 *
 * This closes the "done means" on the relay issue: *two devices sync through it, with no Electron
 * and no X server*. It runs the relay as a child process from the **release artifact** when one
 * exists, because a health probe and a join are not a sync, and the failures that matter live in the
 * packaging rather than in the protocol.
 *
 * It is a script and not a unit test on purpose: the thing under test is a process, its arguments,
 * and two real WebSocket clients. `packages/host/src/server.test.ts` already covers the protocol
 * in-process; repeating that here would prove nothing new about the artifact.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  addDevice,
  createDeviceIdentity,
  createWorkspaceGroup,
  encodeBase64,
  encodeRelayMessage,
  joinWorkspaceGroup,
  open as openMessage,
  RELAY_PROTOCOL_VERSION,
  roleRecordPayload,
  seal,
  signFrame,
} from "@suite/sync";
import { LoroDoc } from "loro-crdt";

const run = promisify(execFile);
const ROOT = resolve(new URL("..", import.meta.url).pathname);

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const log = (message) => console.log(`verify-convergence: ${message}`);
const fail = (message) => {
  console.error(`verify-convergence: FAIL ${message}`);
  process.exit(1);
};

const work = mkdtempSync(join(tmpdir(), "suite-converge-"));
let child = null;
function cleanup() {
  if (child !== null && child.exitCode === null) child.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
  child = null;
}

/** A device the relay can identify: an Ed25519 key, and the id derived from it. */
function relayDevice(name) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const base64 = raw.toString("base64");
  return {
    name,
    publicKey: base64,
    deviceId: createHash("sha256").update(raw).digest("hex"),
    sign: (payload) => sign(null, Buffer.from(payload), privateKey).toString("base64"),
  };
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

/** The relay to run: the built artifact when there is one, else the build in source. */
async function relayCommand() {
  const given = arg("cli");
  if (given !== undefined) {
    const path = resolve(given);
    if (!existsSync(path)) fail(`${path} does not exist`);
    return { entry: path, source: "the CLI you named" };
  }

  const releaseDir = resolve(ROOT, "../apps/suite-sync/dist/release");
  const tarballs = existsSync(releaseDir)
    ? readdirSync(releaseDir).filter((name) => name.endsWith(".tar.gz"))
    : [];
  if (tarballs.length > 0) {
    const tarball = join(releaseDir, tarballs.sort().at(-1));
    const extracted = join(work, "artifact");
    await run("mkdir", ["-p", extracted]);
    await run("tar", ["-xzf", tarball, "-C", extracted]);
    const entry = join(extracted, "suite-sync", "dist", "cli.js");
    if (!existsSync(entry)) fail("the artifact did not unpack to dist/cli.js");
    return { entry, source: `the released artifact (${tarballs.sort().at(-1)})` };
  }

  const built = resolve(ROOT, "../apps/suite-sync/apps/server/dist/cli.js");
  if (!existsSync(built)) {
    fail("no artifact and no build; run `pnpm --filter @suite/sync-server build` or release:relay");
  }
  return { entry: built, source: "the source build (no artifact present)" };
}

/** A relay client: connects, joins, and collects what the host hands back. */
class Peer {
  constructor(socket, device) {
    this.socket = socket;
    this.device = device;
    this.messages = [];
    this.waiters = [];
    socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)));
      for (const waiter of this.waiters) waiter();
      this.waiters = [];
    });
  }

  static async connect(url, device) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", () => resolveOpen(), { once: true });
      socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });
    return new Peer(socket, device);
  }

  send(message) {
    this.socket.send(encodeRelayMessage(message));
  }

  async until(predicate, description, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        const seen = this.messages.map((message) => message.type).join(", ") || "nothing";
        fail(`timed out waiting for ${description} (the peer saw: ${seen})`);
      }
      await new Promise((resolveWait) => {
        this.waiters.push(resolveWait);
        setTimeout(resolveWait, 25);
      });
    }
  }

  close() {
    this.socket.close();
  }
}

async function main() {
  const relay = await relayCommand();
  const port = await freePort();
  const store = join(work, "store");

  log(`starting ${relay.source}`);
  child = spawn(
    process.execPath,
    [
      relay.entry,
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--store",
      store,
      "--trust-all",
    ],
    { cwd: dirnameOf(relay.entry), stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const deadline = Date.now() + 15_000;
  while (!stdout.includes("listening on")) {
    if (child.exitCode !== null) fail(`the relay exited ${child.exitCode}: ${stderr.trim()}`);
    if (Date.now() > deadline) fail(`the relay never said it was listening: ${stderr.trim()}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  const url = /listening on (ws:\/\/\S+)/u.exec(stdout)?.[1] ?? `ws://127.0.0.1:${port}/sync`;
  log(`relay up at ${url}`);

  // One workspace, two members, a real MLS group. No fake crypto: the point is that the shipped
  // relay cannot read any of this.
  const workspaceId = "a".repeat(64);
  const laptopIdentity = await createDeviceIdentity("laptop");
  const phoneIdentity = await createDeviceIdentity("phone");
  const created = await createWorkspaceGroup(workspaceId, laptopIdentity);
  const added = await addDevice(created, phoneIdentity.keyPackage);
  let laptopGroup = added.group;
  let phoneGroup = await joinWorkspaceGroup(added.welcome, phoneIdentity);

  const laptopDevice = relayDevice("laptop");
  const phoneDevice = relayDevice("phone");

  const laptop = await Peer.connect(url, laptopDevice);
  laptop.send({
    type: "join",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    workspaceId,
    deviceId: laptopDevice.deviceId,
    publicKey: laptopDevice.publicKey,
    name: "laptop",
  });
  await laptop.until((m) => m.type === "joined", "the laptop to be let in");

  const phone = await Peer.connect(url, phoneDevice);
  phone.send({
    type: "join",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    workspaceId,
    deviceId: phoneDevice.deviceId,
    publicKey: phoneDevice.publicKey,
    name: "phone",
  });
  await phone.until((m) => m.type === "joined", "the phone to be let in");

  // Roles are not optional. MLS says who is in the group; the host has no idea who may write, so
  // without a role record every frame is refused as `not-authorized` — which is exactly what
  // happened the first time this script ran.
  const roleRecord = (signer, target, role) => {
    const unsigned = {
      workspaceId,
      deviceId: target.deviceId,
      role,
      seq: 0,
      signerId: signer.deviceId,
    };
    return {
      type: "role",
      record: { ...unsigned, signature: signer.sign(roleRecordPayload(unsigned)) },
    };
  };

  laptop.send(roleRecord(laptopDevice, laptopDevice, "owner"));
  await laptop.until(
    (m) => m.type === "applied" && m.deviceId === laptopDevice.deviceId,
    "the laptop's owner role",
  );
  laptop.send(roleRecord(laptopDevice, phoneDevice, "editor"));
  await laptop.until(
    (m) => m.type === "applied" && m.deviceId === phoneDevice.deviceId,
    "the phone's editor role",
  );

  // --- the laptop writes -------------------------------------------------------------------
  const laptopDoc = new LoroDoc();
  laptopDoc.getMap("entry").set("author", "laptop");
  laptopDoc.commit();

  const fromLaptop = await seal(laptopGroup, laptopDoc.export({ mode: "update" }));
  laptopGroup = fromLaptop.group;
  const laptopFrame = signFrame(laptopDevice.sign, {
    kind: "application",
    workspaceId,
    deviceId: laptopDevice.deviceId,
    epoch: laptopGroup.epoch,
    payload: encodeBase64(fromLaptop.message),
  });
  laptop.send({ type: "frame", frame: laptopFrame });

  // --- the phone reads it, writes its own --------------------------------------------------
  const delivered = await phone.until(
    (m) => m.type === "frame" && m.frame.deviceId === laptopDevice.deviceId,
    "the laptop's frame on the phone",
  );
  const opened = await openMessage(phoneGroup, Buffer.from(delivered.frame.payload, "base64"));
  phoneGroup = opened.group;
  const phoneDoc = new LoroDoc();
  phoneDoc.import(opened.plaintext ?? new Uint8Array());
  if (phoneDoc.getMap("entry").get("author") !== "laptop") {
    fail("the phone did not receive the laptop's edit");
  }

  phoneDoc.getMap("entry").set("reviewedBy", "phone");
  phoneDoc.commit();
  const fromPhone = await seal(phoneGroup, phoneDoc.export({ mode: "update" }));
  phoneGroup = fromPhone.group;
  phone.send({
    type: "frame",
    frame: signFrame(phoneDevice.sign, {
      kind: "application",
      workspaceId,
      deviceId: phoneDevice.deviceId,
      epoch: phoneGroup.epoch,
      payload: encodeBase64(fromPhone.message),
    }),
  });

  // --- the laptop reads back, and both agree ----------------------------------------------
  const reply = await laptop.until(
    (m) => m.type === "frame" && m.frame.deviceId === phoneDevice.deviceId,
    "the phone's frame on the laptop",
  );
  const openedBack = await openMessage(laptopGroup, Buffer.from(reply.frame.payload, "base64"));
  laptopGroup = openedBack.group;
  laptopDoc.import(openedBack.plaintext ?? new Uint8Array());

  const laptopView = laptopDoc.toJSON();
  const phoneView = phoneDoc.toJSON();
  if (JSON.stringify(laptopView) !== JSON.stringify(phoneView)) {
    fail(
      `the peers disagree:\n  laptop ${JSON.stringify(laptopView)}\n  phone  ${JSON.stringify(phoneView)}`,
    );
  }
  if (laptopView.entry?.reviewedBy !== "phone") fail("the laptop never saw the phone's edit");
  log(`converged: ${JSON.stringify(laptopView)}`);

  // --- the relay kept nothing it could read -----------------------------------------------
  const kept = filesUnder(store)
    .map((path) => readFileSync(path).toString("utf8"))
    .join("\n");
  // Document content only. A device *name* is metadata the relay is allowed to hold — it is how a
  // person tells one device from another — so looking for "laptop" would fail a correct relay.
  for (const secret of ["author", "reviewedBy", "entry"]) {
    if (kept.includes(secret))
      fail(`the relay store contains document content ("${secret}") in the clear`);
  }
  log("the relay store holds no plaintext");

  laptop.close();
  phone.close();
  log(`PASS: two devices converged through ${relay.source}`);
}

function dirnameOf(path) {
  return path.slice(0, path.lastIndexOf("/")) || ".";
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile() && statSync(path).size > 0) found.push(path);
  }
  return found;
}

try {
  await main();
} finally {
  cleanup();
  process.exit(process.exitCode ?? 0);
}
