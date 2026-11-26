#!/usr/bin/env node
/**
 * Prove every pack builds, installs and does its primary job.
 *
 *   node scripts/pack-readiness.mjs [--no-build] [--json]
 *
 * This is the on-demand counterpart to the gate. It is deliberately not a gate
 * row: it builds four packs, compiles the host, installs each archive into a
 * temporary Desk data root and runs each pack's headless primary-path and phone
 * suites, which takes minutes rather than seconds.
 *
 * What one run records per app:
 *
 *   1. The signed archive the app's builder writes, its version, id,
 *      capabilities, contributions and file count.
 *   2. The archive's SHA-256 against its `.sha256` sidecar, its Ed25519
 *      signature against `SUITE_PACK_PUBLIC_KEY`, every file hash, and the
 *      entry's launch metadata (a CSP that seals the network plus a module
 *      script).
 *   3. A real install through `hosts/desk/src/installedPacks.ts`, the host's
 *      verified path, into a temporary data root; the installed tree and
 *      manifest are checked, then the version is removed and the root is read
 *      again.
 *   4. The pack's own primary path (open/create, edit, save, export and
 *      re-import where the app has documents) and its phone-layout tests.
 *
 * A person still owns the window pass, the release-archive install and the
 * device pass; `docs/reference/pack-readiness.md` says exactly which ones.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parsePackManifest,
  sha256Hex,
  SUITE_PACK_PUBLIC_KEY,
  SUITE_PUBLISHER_ID,
  verifyPackFiles,
  verifyPackSignature,
} from "@suite/pack";
import { readPackArchive } from "@suite/pack-host";
import { KEYS, pinnedPublic, readKey } from "./lib/keys.mjs";
import { publicKeyOfSigningKey } from "./pack.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, ".dev", "pack-readiness");
const DECODER = new TextDecoder();

/**
 * The apps this command proves and the files that prove them.
 *
 * `primary` is the pack's own end-to-end suite: the one that mounts the pack
 * the way the host does. `phone` is the suite that asserts the phone layout.
 * Canvas has mobile CSS but no automated phone-layout test; that absence is a
 * fact to report, not something to invent here.
 */
export const READINESS_PACKS = [
  {
    app: "budget",
    name: "Budget",
    package: "@suite/budget-pack",
    buildScript: "budget:pack",
    sourceManifest: "packs/budget/pack/manifest.json",
    devDir: "packs/budget/.dev",
    primary: ["src/PackRender.test.tsx"],
    phone: ["src/renderer/app/Shell.test.tsx"],
    needsContent: false,
  },
  {
    app: "planner",
    name: "Planner",
    package: "@suite/planner-pack",
    buildScript: "planner:pack",
    sourceManifest: "packs/planner/pack/manifest.json",
    devDir: "packs/planner/.dev",
    primary: ["src/PackRender.test.tsx"],
    phone: [
      "src/renderer/app/Shell.test.tsx",
      "src/renderer/day/DayView.test.tsx",
      "src/renderer/inbox/InboxView.test.tsx",
      "src/renderer/task/TaskDetail.test.tsx",
      "src/renderer/week/WeekView.test.tsx",
    ],
    needsContent: false,
  },
  {
    app: "canvas",
    name: "Canvas",
    package: "@suite/canvas-pack",
    buildScript: "canvas:pack",
    sourceManifest: "packs/canvas/pack/manifest.json",
    devDir: "packs/canvas/.dev",
    primary: ["src/PackRender.test.tsx"],
    phone: [],
    phoneAbsent: "no automated phone test; CSS-only, needs the #358 pass",
    needsContent: false,
  },
  {
    app: "help",
    name: "Help",
    package: "@suite/help-pack",
    buildScript: "help:pack",
    sourceManifest: "packs/help/pack/manifest.json",
    devDir: "packs/help/.dev",
    primary: ["src/PackExplorer.test.tsx", "src/Handbook.test.tsx"],
    phone: ["src/PhoneLayout.test.tsx"],
    needsContent: true,
  },
];

/** The archive the builder writes for one app. */
export function archivePathFor(pack, version, root = ROOT) {
  return join(root, pack.devDir, `${pack.app}-${version}.suitepack`);
}

/**
 * The last line of `scripts/*-pack.mjs` output that names the signed archive.
 *
 * The builders print a human block, so this reads the line rather than the
 * exit code alone: a run that wrote no archive has not proved anything.
 */
export function parseBuildOutput(text) {
  const archive = /^(.*\.suitepack)\s+(\d+) files\s+(\d+) bytes\s+id=(\S+) v(\S+)\s*$/mu.exec(
    text ?? "",
  );
  if (archive === null) return null;
  const sha = /^(.*\.suitepack)\.sha256\s+([0-9a-f]{64})\s*$/mu.exec(text);
  return {
    archivePath: archive[1],
    fileCount: Number(archive[2]),
    totalBytes: Number(archive[3]),
    id: archive[4],
    version: archive[5],
    sha256: sha?.[2] ?? null,
  };
}

/** A compact description of a contribution map: `commands:3, providers:2`. */
export function summarizeContributions(contributions) {
  if (contributions === undefined || contributions === null) return "none";
  const parts = Object.entries(contributions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const count = Array.isArray(value) ? value.length : 1;
      return `${key}:${count}`;
    });
  return parts.length === 0 ? "none" : parts.join(", ");
}

/** The facts a report needs from a signed manifest, without copying the whole file list. */
export function summarizeManifest(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    platforms: manifest.platforms ?? [],
    capabilities: manifest.capabilities ?? [],
    optionalCapabilities: manifest.optionalCapabilities ?? [],
    contributions: summarizeContributions(manifest.contributions),
    documents: (manifest.documents ?? []).map((document) => ({
      id: document.id,
      format: document.format,
      version: document.version,
      mode: document.mode,
    })),
    fileCount: manifest.files.length,
  };
}

/**
 * Why a built entry would not launch as a pack, or an empty list.
 *
 * This is launch metadata, not a launch: the installer's own builders already
 * require a sealed policy, and the host refuses an entry it cannot load. The
 * checks stay here so a hand-built archive is refused by the same facts.
 */
export function entryProblems(manifest, files) {
  const problems = [];
  if (!files.has(manifest.entry)) {
    problems.push(`the entry ${manifest.entry} is not in the archive`);
    return problems;
  }
  const html = DECODER.decode(files.get(manifest.entry));
  if (!/<meta\b[^>]*http-equiv="Content-Security-Policy"/iu.test(html)) {
    problems.push("the entry has no Content-Security-Policy meta tag");
  }
  if (!/default-src\s+'self'/u.test(html) || !/connect-src\s+'self'/u.test(html)) {
    problems.push("the entry's CSP does not name default-src 'self' and connect-src 'self'");
  }
  if (!/<script\b(?=[^>]*\btype="module")[^>]*\bsrc="[^"]+"/iu.test(html)) {
    problems.push("the entry has no module script");
  }
  return problems;
}

/** The test-file facts from a Vitest JSON report, checked against the files a pack claims. */
export function summarizeTestReport(report, expectedFiles) {
  const results = new Map(
    (report?.testResults ?? []).map((file) => [
      String(file.name).replaceAll("\\", "/"),
      file,
    ]),
  );
  const missing = [];
  const failed = [];
  let tests = 0;
  let passed = 0;

  for (const expected of expectedFiles) {
    const suffix = `/${expected.replaceAll("\\", "/")}`;
    const match = [...results.entries()].find(
      ([name]) => name === expected || name.endsWith(suffix),
    );
    if (match === undefined) {
      missing.push(expected);
      continue;
    }
    const [, file] = match;
    if (file.status !== "passed") failed.push(expected);
    for (const assertion of file.assertionResults ?? []) {
      tests += 1;
      if (assertion.status === "passed") passed += 1;
    }
  }

  return {
    ok: report?.success === true && missing.length === 0 && failed.length === 0,
    files: expectedFiles.length,
    tests,
    passed,
    missing,
    failed,
  };
}

function status(value) {
  return value ? "ok" : "FAIL";
}

function testLabel(result, absent = "absent") {
  if (result.files === 0) return absent;
  return `${status(result.ok)} (${result.files} file${result.files === 1 ? "" : "s"}, ${result.passed}/${result.tests} tests)`;
}

/**
 * The four-row matrix. Kept as a pure function so the report and the command
 * print the same facts and the test can prove the shape.
 */
export function formatMatrix(rows) {
  const lines = [
    "| App | Version | Capabilities | Optional / conditional | Contributions | Files | Signature | Shape | Launch metadata | Install/remove | Primary path | Phone smoke |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const capabilities = row.capabilities.join(", ") || "none";
    const optional = row.optionalCapabilities.join(", ") || "none";
    lines.push(
      `| ${row.app} | ${row.version} | ${capabilities} | ${optional} | ${row.contributions} | ${row.fileCount} | ` +
        `${status(row.signature)} | ${status(row.shape)} | ${status(row.launch)} | ` +
        `${status(row.install)} | ${testLabel(row.primary)} | ` +
        `${testLabel(row.phone, row.phoneAbsent ?? "absent")} |`,
    );
  }
  return lines.join("\n");
}

function run(command, args, { cwd = ROOT, capture = true } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? "pipe" : "inherit",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

function tail(text, lines = 30) {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

/** Fail before a build if the key on this machine is not the key this tree pins. */
function requirePinnedKey() {
  const key = process.env[KEYS.pack.env] ?? readKey("pack");
  if (key === null || key === undefined || key.trim() === "") {
    throw new Error(
      "No pack signing key. Run `pnpm keys status` to see what this machine has; " +
        `\`${KEYS.pack.generate}\` makes one. A pack that is not signed is not installable, by design.`,
    );
  }
  const pinned = pinnedPublic("pack");
  if (pinned === null) {
    throw new Error(
      `${KEYS.pack.pinName} is missing from ${KEYS.pack.pinFile}; there is nothing to check the key against.`,
    );
  }
  const actual = publicKeyOfSigningKey(key);
  if (actual !== pinned) {
    throw new Error(
      `The pack signing key does not match ${KEYS.pack.pinName}. ` +
        "What it signs would be refused as untrusted, so nothing was signed. " +
        "Run `pnpm keys status` to compare fingerprints.",
    );
  }
}

/**
 * Read and verify one archive without installing it.
 *
 * `installPackArchive` verifies again; this is the part a report can name:
 * the sidecar digest, the signature against the pin, every payload hash, and
 * the entry's launch metadata.
 */
export async function inspectArchive(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const sha256 = await sha256Hex(bytes);
  const sidecarPath = `${path}.sha256`;
  const sidecar = existsSync(sidecarPath)
    ? readFileSync(sidecarPath, "utf8").trim().split(/\s+/u)[0]
    : null;
  const archive = await readPackArchive(bytes);
  const parsed = parsePackManifest(JSON.parse(DECODER.decode(archive.manifestBytes)));
  if (!parsed.ok) {
    throw new Error(
      `The archive manifest is invalid: ${parsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const manifest = parsed.value;
  const signature = await verifyPackSignature(manifest, SUITE_PACK_PUBLIC_KEY);
  const fileMismatches = await verifyPackFiles(
    manifest,
    async (filePath) => archive.files.get(filePath) ?? null,
  );
  const launch = entryProblems(manifest, archive.files);

  return {
    bytes,
    sha256,
    sidecar,
    sidecarMatches: sidecar === sha256,
    manifest,
    summary: summarizeManifest(manifest),
    signature,
    fileMismatches,
    launch,
    archiveFiles: archive.files,
  };
}

/** Compile the host's modules so the install path under test is the same code the app ships. */
function compileHost() {
  return run("pnpm", ["--filter", "@suite/desk", "exec", "tsc", "-p", "tsconfig.build.json"]);
}

/** Install, read the installed tree, remove, and read the root again. */
async function installAndRemove(app, verified) {
  const { manifest } = verified;
  const installedPacksUrl = pathToFileURL(join(ROOT, "hosts", "desk", "dist", "installedPacks.js"));
  const packsUrl = pathToFileURL(join(ROOT, "hosts", "desk", "dist", "packs.js"));
  const [{ installPackArchive, loadInstalledPacks, uninstallPackVersion }, { HOST_CAPABILITIES }] =
    await Promise.all([import(installedPacksUrl.href), import(packsUrl.href)]);

  const options = {
    publishers: [
      { id: SUITE_PUBLISHER_ID, key: SUITE_PACK_PUBLIC_KEY, source: "preinstalled" },
    ],
    hostContractVersion: 1,
    hostVersion: 1,
    hostCapabilities: HOST_CAPABILITIES,
  };

  const parent = join(OUT_DIR, "roots");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, `${app}-`));

  try {
    const installed = await installPackArchive(verified.bytes, root, options);
    const expectedRoot = join(root, manifest.id, manifest.version);
    if (resolve(installed.root) !== resolve(expectedRoot)) {
      throw new Error(`installed at ${installed.root}, expected ${expectedRoot}`);
    }

    const installedManifest = parsePackManifest(
      JSON.parse(readFileSync(join(installed.root, "manifest.json"), "utf8")),
    );
    if (!installedManifest.ok) throw new Error("the installed manifest is invalid");
    if (
      installedManifest.value.id !== manifest.id ||
      installedManifest.value.version !== manifest.version ||
      installedManifest.value.signature !== manifest.signature
    ) {
      throw new Error("the installed manifest differs from the verified archive");
    }

    // The installed view is what the host offers the pack: required and optional
    // capabilities, and its contributions. A capability dropped by the builder
    // would install cleanly and only fail when the pack asks for it.
    const expectedCapabilities = new Set([
      ...manifest.capabilities,
      ...(manifest.optionalCapabilities ?? []),
    ]);
    const missingCapabilities = [...expectedCapabilities].filter(
      (capability) => !installed.capabilities.includes(capability),
    );
    if (missingCapabilities.length > 0) {
      throw new Error(
        `the installed pack is missing capabilities ${missingCapabilities.join(", ")}`,
      );
    }
    const installedContributions = JSON.stringify(installed.contributions ?? {});
    if (installedContributions !== JSON.stringify(manifest.contributions ?? {})) {
      throw new Error("the installed pack's contributions differ from the signed manifest");
    }

    let files = 0;
    for (const file of manifest.files) {
      const bytes = new Uint8Array(readFileSync(join(installed.root, ...file.path.split("/"))));
      if (bytes.byteLength !== file.bytes || (await sha256Hex(bytes)) !== file.sha256) {
        throw new Error(`the installed file ${file.path} does not match the signed hash`);
      }
      files += 1;
    }

    const scan = await loadInstalledPacks(root, options);
    if (scan.issues.length > 0) {
      throw new Error(
        `the installed scan reported ${scan.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
    if (scan.packs.length !== 1 || scan.packs[0]?.id !== manifest.id) {
      throw new Error("the installed scan did not return the pack it just installed");
    }

    await uninstallPackVersion(root, manifest.id, manifest.version);

    const after = await loadInstalledPacks(root, options);
    if (after.packs.length !== 0 || after.issues.length !== 0) {
      throw new Error("the root still reports a pack after removal");
    }
    if (existsSync(installed.root)) throw new Error("the removed version directory still exists");

    const idDir = join(root, manifest.id);
    const leftover = existsSync(idDir) ? readdirSync(idDir).sort() : [];
    const unexpected = leftover.filter((entry) => entry !== "publisher.json");
    if (unexpected.length > 0) {
      throw new Error(`removal left ${unexpected.join(", ")} under the id directory`);
    }

    return {
      ok: true,
      files,
      publisher: installed.publisher,
      leftover,
      detail: `${manifest.id} ${manifest.version} installed, verified and removed`,
    };
  } catch (error) {
    return {
      ok: false,
      files: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function buildPack(pack) {
  const result = run("pnpm", [pack.buildScript], { capture: true });
  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

function prepareContent(pack) {
  for (const script of ["index", "sync"]) {
    const result = run("pnpm", ["--filter", pack.package, "run", script]);
    if (result.status !== 0) {
      return { ok: false, output: `${result.stdout}\n${result.stderr}` };
    }
  }
  return { ok: true, output: "" };
}

function runTests(pack) {
  if (pack.needsContent) {
    const content = prepareContent(pack);
    if (!content.ok) return { status: 1, stdout: content.output, stderr: "" };
  }
  const outPath = join(OUT_DIR, "tests", `${pack.app}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  rmSync(outPath, { force: true });
  const result = run("pnpm", [
    "--filter",
    pack.package,
    "exec",
    "vitest",
    "run",
    "--config",
    "pack/vitest.config.mts",
    ...pack.primary,
    ...pack.phone,
    "--reporter=json",
    `--outputFile=${outPath}`,
  ]);
  return { ...result, outPath };
}

function readTestReport(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function checkPack(pack, { noBuild, quiet = false }) {
  const progress = (message) => {
    if (!quiet) process.stdout.write(message);
  };
  const row = {
    app: pack.app,
    name: pack.name,
    version: "?",
    capabilities: [],
    optionalCapabilities: [],
    contributions: "none",
    fileCount: 0,
    signature: false,
    shape: true,
    launch: false,
    install: false,
    primary: { ok: false, files: pack.primary.length, tests: 0, passed: 0 },
    phone: { ok: pack.phone.length === 0, files: pack.phone.length, tests: 0, passed: 0 },
    phoneAbsent:
      pack.phoneAbsent ?? (pack.phone.length === 0 ? "no automated phone test" : "absent"),
    build: { ok: true, detail: "reused" },
    installDetail: "",
    testDetail: "",
  };

  const source = JSON.parse(readFileSync(join(ROOT, pack.sourceManifest), "utf8"));
  row.version = source.version;
  row.capabilities = source.capabilities ?? [];
  row.optionalCapabilities = source.optionalCapabilities ?? [];
  row.contributions = summarizeContributions(source.contributions);

  const archivePath = archivePathFor(pack, source.version);

  if (!noBuild) {
    progress(`\n▶ build ${pack.app}\n`);
    const build = buildPack(pack);
    row.build = { ok: build.ok, detail: build.ok ? "built" : `exit ${build.status}` };
    if (!build.ok) {
      process.stderr.write(`${tail(build.output)}\n`);
      return row;
    }
    const parsed = parseBuildOutput(build.output);
    if (parsed !== null) {
      row.version = parsed.version;
      row.fileCount = parsed.fileCount;
    }
  }

  if (!existsSync(archivePath)) {
    row.build = {
      ok: false,
      detail: `no archive at ${relative(ROOT, archivePath)}${noBuild ? " (run without --no-build)" : ""}`,
    };
    return row;
  }

  let verified;
  try {
    verified = await inspectArchive(archivePath);
  } catch (error) {
    row.build = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    return row;
  }

  row.version = verified.summary.version;
  row.capabilities = verified.summary.capabilities;
  row.optionalCapabilities = verified.summary.optionalCapabilities;
  row.contributions = verified.summary.contributions;
  row.fileCount = verified.summary.fileCount;
  row.signature =
    verified.signature && verified.sidecarMatches && verified.fileMismatches.length === 0;
  row.launch = verified.launch.length === 0;

  if (!row.signature) {
    const reasons = [];
    if (!verified.signature) reasons.push("the signature does not verify against the pin");
    if (!verified.sidecarMatches) reasons.push("the .sha256 sidecar does not match the archive");
    if (verified.fileMismatches.length > 0) {
      reasons.push(
        `file hash mismatch: ${verified.fileMismatches
          .map((mismatch) => `${mismatch.path} (${mismatch.reason})`)
          .join(", ")}`,
      );
    }
    row.installDetail = reasons.join("; ");
    return row;
  }
  if (!row.launch) {
    row.installDetail = `launch metadata: ${verified.launch.join("; ")}`;
    return row;
  }

  progress(`\n▶ install ${pack.app}\n`);
  const install = await installAndRemove(pack, verified);
  row.install = install.ok;
  row.installDetail = install.detail;
  if (!install.ok) process.stderr.write(`${install.detail}\n`);

  progress(`\n▶ tests ${pack.app}\n`);
  const tests = runTests(pack);
  const report = tests.outPath === undefined ? null : readTestReport(tests.outPath);
  const primary = summarizeTestReport(report, pack.primary);
  const phone = summarizeTestReport(report, pack.phone);
  row.primary = primary;
  row.phone = phone;
  row.testDetail = [
    `vitest exit ${tests.status}`,
    ...primary.missing.map((file) => `missing ${file}`),
    ...primary.failed.map((file) => `failed ${file}`),
    ...phone.missing.map((file) => `missing ${file}`),
    ...phone.failed.map((file) => `failed ${file}`),
  ].join("; ");
  if (tests.status !== 0 || !primary.ok || (!phone.ok && pack.phone.length > 0)) {
    process.stderr.write(`${tail(`${tests.stdout}\n${tests.stderr}`)}\n`);
  }

  return row;
}

function usage() {
  return `Suite pack readiness

  node scripts/pack-readiness.mjs [--no-build] [--json]

  --no-build  reuse each pack's existing archive instead of rebuilding it
  --json      print the structured result instead of the matrix

Builds Budget, Planner, Canvas and Help, verifies each archive against
${KEYS.pack.pinName}, installs and removes it through the Desk host, and runs
each pack's primary-path and phone-layout tests. A person still owns the
window, release-archive and device passes; see docs/reference/pack-readiness.md.
`;
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }
  const known = new Set(["--no-build", "--json"]);
  for (const flag of argv) {
    if (flag.startsWith("--") && !known.has(flag)) {
      process.stderr.write(`pack-readiness: unknown option ${flag}\n`);
      return 2;
    }
  }

  const noBuild = argv.includes("--no-build");
  const json = argv.includes("--json");
  mkdirSync(OUT_DIR, { recursive: true });

  if (!noBuild) requirePinnedKey();

  if (!json) process.stdout.write("\n▶ pack shape\n");
  const shape = run("node", ["scripts/pack-shape.mjs"], { capture: json });
  if (shape.status !== 0) {
    if (json) process.stderr.write(`${tail(`${shape.stdout}\n${shape.stderr}`)}\n`);
    process.stderr.write("pack-readiness: pack shape failed\n");
    return 1;
  }

  if (!noBuild) {
    if (!json) process.stdout.write("\n▶ host modules\n");
    const host = compileHost();
    if (host.status !== 0) {
      process.stderr.write(
        `pack-readiness: the host modules did not compile\n${tail(`${host.stdout}\n${host.stderr}`)}\n`,
      );
      return 1;
    }
  } else if (!existsSync(join(ROOT, "hosts", "desk", "dist", "installedPacks.js"))) {
    process.stderr.write(
      "pack-readiness: the host modules are not built; run once without --no-build\n",
    );
    return 1;
  }

  const rows = [];
  for (const pack of READINESS_PACKS) {
    rows.push(await checkPack(pack, { noBuild, quiet: json }));
  }

  const ok = rows.every(
    (row) =>
      row.build.ok &&
      row.signature &&
      row.shape &&
      row.launch &&
      row.install &&
      row.primary.ok &&
      (row.phone.files === 0 || row.phone.ok),
  );

  const matrix = formatMatrix(rows);
  const summary = { ok, at: new Date().toISOString(), rows };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`\n${matrix}\n`);
    for (const row of rows) {
      const notes = [
        row.installDetail,
        row.testDetail,
        row.build.ok ? null : `build: ${row.build.detail}`,
      ].filter((note) => typeof note === "string" && note.length > 0);
      if (notes.length > 0) process.stdout.write(`\n${row.app}: ${notes.join("; ")}`);
    }
    process.stdout.write(`\n${ok ? "pack readiness passed" : "pack readiness failed"}\n`);
  }

  const summaryPath = join(OUT_DIR, "summary.json");
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!json) process.stdout.write(`summary ${relative(ROOT, summaryPath)}\n`);

  return ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`pack-readiness: ${error.message}\n`);
    process.exit(1);
  }
}
