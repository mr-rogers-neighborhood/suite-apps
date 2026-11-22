#!/usr/bin/env node
/**
 * Check `slopmaster.profile.json` against slopmaster's factory profile schema.
 *
 * The authority is `slopmaster9000/packages/factory/src/profile.ts`, which
 * declares `FactoryProfileSchema` and the `ToolchainName` enum for profile
 * version 1. That package is not vendored here, so this script restates the
 * same strict shape and adds the Suite invariants on top. When the profile is
 * consumed, `slopmaster9000` remains the validator that decides.
 *
 * What this check enforces:
 *
 *   1. The exact schema: `v: 1`, a plain `apps` array, the toolchain enum, and
 *      `{ command }` objects. Unknown fields, a wrong version, a shell string, a
 *      duplicate app id and an unknown toolchain name are refused.
 *   2. The Suite invariants: the gate, build and display commands are the real
 *      invocations in this checkout, `fresh` is true, the release prefix is
 *      `slop/`, and every app points at a real package and its own `slop/` build.
 *   3. No secret and no host path. `repo.path` is the absolute guest checkout;
 *      every other path is relative to that checkout.
 *   4. Optionally, a local JSON Schema file when one is supplied with `--schema`
 *      or `SLOPMASTER_PROFILE_SCHEMA`. No schema file is committed here, and the
 *      check never reaches for the private slopmaster repository.
 *
 * Usage:
 *   node scripts/profile-check.mjs
 *   node scripts/profile-check.mjs --profile slopmaster.profile.json
 *   node scripts/profile-check.mjs --schema path/to/profile.schema.json
 *
 * The optional schema supports the JSON Schema subset a profile needs: `type`,
 * `required`, `properties`, `additionalProperties`, `items`, `enum`, `const`,
 * `pattern`, `minLength`, `maxLength`, `minItems`, `maxItems` and `anyOf`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_PATH = join(ROOT, "slopmaster.profile.json");

/** `FactoryProfileSchema` in slopmaster9000, profile version 1. */
const PROFILE_VERSION = 1;
const PROFILE_ID = "suite-apps";
const PROFILE_ID_MAX = 63;
const APP_ID_MAX = 40;

/** The toolchain enum, verbatim from `profile.ts`. */
const TOOLCHAIN = [
  "git",
  "node22",
  "pnpm12",
  "docker",
  "xvfb",
  "electron-gtk",
  "flatpak-builder",
  "orca",
];

/** Top-level keys. `env` has a default in the schema, so it may be absent. */
const PROFILE_KEYS = [
  "v",
  "id",
  "repo",
  "apps",
  "toolchain",
  "gate",
  "build",
  "release",
  "display",
  "env",
];
const PROFILE_REQUIRED = PROFILE_KEYS.filter((key) => key !== "env");
const REPO_KEYS = ["url", "ref", "path"];
const APP_KEYS = ["id", "path", "manifest", "slop_build_path"];
const GATE_KEYS = ["command", "fresh"];
const COMMAND_KEYS = ["command"];
const RELEASE_KEYS = ["branch_prefix", "tier"];

/** The real Suite invocations, spelled once. */
const GATE_COMMAND = ["node", "scripts/gate.mjs", "--only", "{app}"];
const BUILD_COMMAND = [
  "node",
  "scripts/flatpak.mjs",
  "--app",
  "{app}",
  "--channel",
  "slop",
  "--session",
];
const DISPLAY_COMMAND = ["flatpak", "run", "run.suite.slop.{app}"];
const REPO_REF = "main";
const REPO_GUEST_PATH = "/workspace/suite-apps";

/** The app-set release convention: `slop` → `nightly` → `preview` → `stable`. */
const LADDER = ["slop", "nightly", "preview", "stable"];
const BRANCH_PREFIX = "slop/";
const TIER = "slop";

/** The apps that can be queued: a Flatpak manifest and a `slop` identity. */
const APPS = ["canvas", "planner", "budget", "help"];

const APP_ID = /^[a-z0-9][a-z0-9-]*$/u;
const GUEST_PATH = /^\/[A-Za-z0-9._/-]+$/u;
const BRANCH_PREFIX_PATTERN = /^[A-Za-z0-9._-]+\/$/u;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const PLACEHOLDER = /\{([^}]*)\}/gu;

/** `SECRET_PATTERNS` in `profile.ts`, plus the name-shaped check this repo adds. */
const SECRET_PATTERNS = [
  /\bghp_[A-Za-z0-9]{20,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/u,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/u,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/iu,
];
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|SALT|OAUTH|STORE_KEY)/u;

/** Host homes that must never become the guest checkout. */
const HOST_HOME = /^\/(?:home|Users|root|var\/home)\//u;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

/** Require exactly `keys`; `required` is the subset that must be present. */
function exactKeys(value, keys, path, errors, required = keys) {
  if (!isObject(value)) {
    error(errors, path, "must be an object");
    return false;
  }
  for (const key of required) {
    if (!(key in value)) error(errors, `${path}.${key}`, "is required");
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) error(errors, `${path}.${key}`, "is not a known field");
  }
  return true;
}

function nonEmptyString(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    error(errors, path, "must be a non-empty string");
    return false;
  }
  return true;
}

/** A RelativePath in `profile.ts`: no leading slash, no `..`, no NUL. */
function relativePath(value, path, errors) {
  if (!nonEmptyString(value, path, errors)) return false;
  if (value.startsWith("/")) {
    error(errors, path, `must be relative to the checkout (${value})`);
    return false;
  }
  if (value.split(/[\\/]/u).includes("..")) {
    error(errors, path, `must not contain .. (${value})`);
    return false;
  }
  if (value.includes("\0")) {
    error(errors, path, "must not contain a NUL byte");
    return false;
  }
  return true;
}

/** A command is an argv array, never a shell string; `{app}` is the only slot. */
function command(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    error(errors, path, "must be a non-empty argv array");
    return false;
  }
  let ok = true;
  for (const [index, arg] of value.entries()) {
    if (typeof arg !== "string" || arg.length === 0) {
      error(errors, `${path}[${index}]`, "must be a non-empty string");
      ok = false;
      continue;
    }
    for (const match of arg.matchAll(PLACEHOLDER)) {
      if (match[1] !== "app") {
        error(errors, `${path}[${index}]`, `has an unknown placeholder {${match[1] ?? ""}}`);
        ok = false;
      }
    }
  }
  return ok;
}

function commandObject(value, path, errors, { fresh = false } = {}) {
  const keys = fresh ? GATE_KEYS : COMMAND_KEYS;
  const required = fresh ? ["command"] : COMMAND_KEYS;
  if (!exactKeys(value, keys, path, errors, required)) return false;
  command(value.command, `${path}.command`, errors);
  if (fresh && "fresh" in value && typeof value.fresh !== "boolean") {
    error(errors, `${path}.fresh`, "must be a boolean");
  }
  return true;
}

function sameCommand(value, expected, path, errors) {
  const got = JSON.stringify(value);
  const want = JSON.stringify(expected);
  if (got !== want) {
    error(errors, `${path}.command`, `must be ${want}; found ${got}`);
  }
}

/** Walk every string for a token or private key. */
function hasSecret(value) {
  if (typeof value === "string") return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some((item) => hasSecret(item));
  if (isObject(value)) return Object.values(value).some((item) => hasSecret(item));
  return false;
}

function checkoutPath(value, path, kind, root, errors) {
  if (!relativePath(value, path, errors)) return false;
  const target = resolve(root, value);
  if (!existsSync(target)) {
    error(errors, path, `does not exist (${value})`);
    return false;
  }
  if (kind === "directory" && !statSync(target).isDirectory()) {
    error(errors, path, `must be a directory (${value})`);
  }
  if (kind === "file" && !statSync(target).isFile()) {
    error(errors, path, `must be a file (${value})`);
  }
  return true;
}

/** The committed Flatpak manifest that proves an app can be slop-built. */
function flatpakManifest(app) {
  return `packaging/flatpak/run.suite.${app}.yml`;
}

function checkRepo(repo, errors) {
  if (!exactKeys(repo, REPO_KEYS, "repo", errors)) return;

  if (nonEmptyString(repo.url, "repo.url", errors)) {
    if (!/^https:\/\//u.test(repo.url)) {
      error(errors, "repo.url", "must be an https remote");
    }
    if (/\/\/[^/]*@/u.test(repo.url)) {
      error(errors, "repo.url", "must not embed credentials");
    }
  }

  if (nonEmptyString(repo.ref, "repo.ref", errors) && repo.ref !== REPO_REF) {
    error(errors, "repo.ref", `must track ${REPO_REF}; found ${JSON.stringify(repo.ref)}`);
  }

  if (nonEmptyString(repo.path, "repo.path", errors)) {
    if (!GUEST_PATH.test(repo.path)) {
      error(errors, "repo.path", "must be an absolute guest path without spaces or shell characters");
    }
    if (HOST_HOME.test(repo.path)) {
      error(errors, "repo.path", `must be the guest checkout, not a host home (${repo.path})`);
    }
    if (repo.path !== REPO_GUEST_PATH) {
      error(errors, "repo.path", `must be ${REPO_GUEST_PATH}; found ${repo.path}`);
    }
  }
}

function checkApps(apps, root, errors) {
  if (!Array.isArray(apps) || apps.length === 0) {
    error(errors, "apps", "must be a non-empty array");
    return;
  }

  const ids = new Set();
  for (const [index, app] of apps.entries()) {
    const path = `apps[${index}]`;
    if (!exactKeys(app, APP_KEYS, path, errors)) continue;

    if (nonEmptyString(app.id, `${path}.id`, errors)) {
      if (!APP_ID.test(app.id)) {
        error(errors, `${path}.id`, "must be lower-case and URL-safe");
      }
      if (app.id.length > APP_ID_MAX) {
        error(errors, `${path}.id`, `must be at most ${APP_ID_MAX} characters`);
      }
      if (ids.has(app.id)) {
        error(errors, `${path}.id`, `duplicates ${app.id}`);
      }
      ids.add(app.id);
    }

    checkoutPath(app.path, `${path}.path`, "directory", root, errors);

    if (checkoutPath(app.manifest, `${path}.manifest`, "file", root, errors)) {
      if (typeof app.path === "string" && app.manifest !== `${app.path}/package.json`) {
        error(errors, `${path}.manifest`, `must be ${app.path}/package.json`);
      }
    }

    if (relativePath(app.slop_build_path, `${path}.slop_build_path`, errors)) {
      if (typeof app.path === "string" && app.slop_build_path !== `${app.path}/slop`) {
        error(errors, `${path}.slop_build_path`, `must be ${app.path}/slop`);
      }
    }

    if (typeof app.id === "string" && APP_ID.test(app.id)) {
      const manifest = flatpakManifest(app.id);
      if (!existsSync(join(root, manifest))) {
        error(
          errors,
          `${path}.id`,
          `has no Flatpak manifest at ${manifest}, so it cannot be slop-built`,
        );
      }
    }
  }

  const expected = APPS.join(", ");
  const found = [...ids].join(", ");
  if (found !== expected) {
    error(errors, "apps", `must list ${expected}; found ${found || "nothing"}`);
  }
}

function checkToolchain(toolchain, errors) {
  if (!Array.isArray(toolchain) || toolchain.length === 0) {
    error(errors, "toolchain", "must be a non-empty array of toolchain names");
    return;
  }
  for (const [index, name] of toolchain.entries()) {
    if (typeof name !== "string" || !TOOLCHAIN.includes(name)) {
      error(
        errors,
        `toolchain[${index}]`,
        `must be one of ${TOOLCHAIN.join(", ")}; found ${JSON.stringify(name)}`,
      );
    }
  }
}

function checkRelease(release, errors) {
  if (!exactKeys(release, RELEASE_KEYS, "release", errors)) return;

  if (nonEmptyString(release.branch_prefix, "release.branch_prefix", errors)) {
    if (!BRANCH_PREFIX_PATTERN.test(release.branch_prefix)) {
      error(errors, "release.branch_prefix", "must end in / and hold no spaces");
    }
    if (release.branch_prefix !== BRANCH_PREFIX) {
      error(
        errors,
        "release.branch_prefix",
        `must be ${JSON.stringify(BRANCH_PREFIX)}; found ${JSON.stringify(release.branch_prefix)}`,
      );
    }
    if (release.branch_prefix.length > 40) {
      error(errors, "release.branch_prefix", "must be at most 40 characters");
    }
  }

  if (nonEmptyString(release.tier, "release.tier", errors)) {
    if (!LADDER.includes(release.tier)) {
      error(errors, "release.tier", `must be one of ${LADDER.join(", ")}`);
    } else if (release.tier === "stable") {
      error(errors, "release.tier", "is the released tier; the profile builds a pre-release");
    }
    if (release.tier !== TIER) {
      error(errors, "release.tier", `must be ${JSON.stringify(TIER)}; found ${JSON.stringify(release.tier)}`);
    }
    if (release.tier.length > 20) {
      error(errors, "release.tier", "must be at most 20 characters");
    }
  }
}

function checkEnv(env, errors) {
  if (env === undefined) return;
  if (!Array.isArray(env)) {
    error(errors, "env", "must be an array of environment names");
    return;
  }
  const seen = new Set();
  for (const [index, name] of env.entries()) {
    const path = `env[${index}]`;
    if (typeof name !== "string" || !ENV_NAME.test(name)) {
      error(errors, path, "must be an upper-case environment name");
      continue;
    }
    if (SECRET_NAME.test(name)) {
      error(errors, path, "names a credential; the allowlist carries none");
    }
    if (seen.has(name)) {
      error(errors, path, `duplicates ${name}`);
    }
    seen.add(name);
  }
}

/** The structural check the repository always runs. */
function checkProfile(profile, { root = ROOT } = {}) {
  const errors = [];

  if (!exactKeys(profile, PROFILE_KEYS, "profile", errors, PROFILE_REQUIRED)) {
    return errors;
  }

  if (profile.v !== PROFILE_VERSION) {
    error(errors, "v", `must be the number ${PROFILE_VERSION}; an unknown version is refused`);
  }

  if (nonEmptyString(profile.id, "id", errors)) {
    if (!APP_ID.test(profile.id)) {
      error(errors, "id", "must be lower-case and URL-safe");
    }
    if (profile.id.length > PROFILE_ID_MAX) {
      error(errors, "id", `must be at most ${PROFILE_ID_MAX} characters`);
    }
    if (profile.id !== PROFILE_ID) {
      error(errors, "id", `must be ${JSON.stringify(PROFILE_ID)}; found ${JSON.stringify(profile.id)}`);
    }
  }

  checkRepo(profile.repo, errors);
  checkApps(profile.apps, root, errors);
  checkToolchain(profile.toolchain, errors);

  if (commandObject(profile.gate, "gate", errors, { fresh: true })) {
    sameCommand(profile.gate.command, GATE_COMMAND, "gate", errors);
    const fresh = profile.gate.fresh ?? true;
    if (fresh !== true) {
      error(errors, "gate.fresh", "must be true; the factory proves the commit, not the tree");
    }
  }

  if (commandObject(profile.build, "build", errors)) {
    sameCommand(profile.build.command, BUILD_COMMAND, "build", errors);
  }

  checkRelease(profile.release, errors);

  if (commandObject(profile.display, "display", errors)) {
    sameCommand(profile.display.command, DISPLAY_COMMAND, "display", errors);
  }

  checkEnv(profile.env, errors);

  for (const [path, value] of [
    ["gate", profile.gate],
    ["build", profile.build],
  ]) {
    const script = Array.isArray(value?.command) ? value.command[1] : undefined;
    if (typeof script === "string" && script.endsWith(".mjs") && !existsSync(join(root, script))) {
      error(errors, `${path}.command[1]`, `is not a script in this checkout (${script})`);
    }
  }

  if (hasSecret(profile)) {
    error(errors, "profile", "contains something that looks like a secret");
  }

  return errors;
}

/** A JSON Schema value check over the subset a profile needs. */
function checkSchemaValue(value, schema, path, errors) {
  if (!isObject(schema)) return;
  const fail = (message) => error(errors, path, `${message} (schema)`);

  if ("const" in schema && value !== schema.const) {
    fail(`must be ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    fail(`must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (Array.isArray(schema.anyOf)) {
    const passes = schema.anyOf.some(
      (option) => checkSchemaValue(value, option, path, []).length === 0,
    );
    if (!passes) {
      const shape = schema.anyOf.map((option) => JSON.stringify(option.type ?? option)).join(" or ");
      fail(`must match one of ${shape}`);
      return errors;
    }
  }

  const type = schema.type;
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (type !== undefined) {
    const allowed = Array.isArray(type) ? type : [type];
    const matches = allowed.some(
      (name) => name === actual || (name === "integer" && Number.isInteger(value)),
    );
    if (!matches) {
      fail(`must be ${allowed.join(" or ")}`);
      return errors;
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      fail(`must be at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      fail(`must be at most ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      fail(`must match ${schema.pattern}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      fail(`must hold at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      fail(`must hold at most ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      for (const [index, item] of value.entries()) {
        checkSchemaValue(item, schema.items, `${path}[${index}]`, errors);
      }
    }
  }

  if (isObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) error(errors, `${path}.${key}`, "is required (schema)");
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) checkSchemaValue(value[key], child, `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) {
          error(errors, `${path}.${key}`, "is not allowed (schema)");
        }
      }
    } else if (isObject(schema.additionalProperties)) {
      for (const [key, child] of Object.entries(value)) {
        if (!(key in (schema.properties ?? {}))) {
          checkSchemaValue(child, schema.additionalProperties, `${path}.${key}`, errors);
        }
      }
    }
  }

  return errors;
}

/**
 * Where an optional local schema sits. No schema file is committed in this
 * repository, so the default is `null` and the step is skipped.
 */
function resolveSchema({ explicit, env = process.env } = {}) {
  if (explicit) return { path: resolve(explicit), required: true };
  if (env.SLOPMASTER_PROFILE_SCHEMA) {
    return { path: resolve(env.SLOPMASTER_PROFILE_SCHEMA), required: true };
  }
  return { path: null, required: false };
}

function validateProfile(profile, { root = ROOT, schemaPath = null, env = process.env } = {}) {
  const errors = checkProfile(profile, { root });
  const resolved = resolveSchema({ explicit: schemaPath, env });

  let schema = "skipped";
  if (resolved.path !== null) {
    if (!existsSync(resolved.path)) {
      if (resolved.required) {
        errors.push(`schema: ${resolved.path} was named but does not exist`);
        schema = "failed";
      }
    } else {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(resolved.path, "utf8"));
      } catch (cause) {
        errors.push(`schema: ${resolved.path} is not JSON (${cause.message})`);
        schema = "failed";
      }
      if (parsed !== undefined) {
        checkSchemaValue(profile, parsed, "profile", errors);
        schema = "validated";
      }
    }
  }

  return { ok: errors.length === 0, errors, schema, schemaPath: resolved.path };
}

function parseArgs(argvList) {
  const options = { profile: PROFILE_PATH, schema: null };
  for (let index = 0; index < argvList.length; index += 1) {
    const flag = argvList[index];
    const value = argvList[index + 1];
    if (flag !== "--profile" && flag !== "--schema") {
      throw new Error(
        `unknown argument ${flag}; usage: profile-check.mjs [--profile <path>] [--schema <path>]`,
      );
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    if (flag === "--profile") options.profile = resolve(value);
    else options.schema = resolve(value);
    index += 1;
  }
  return options;
}

function main(argvList) {
  let options;
  try {
    options = parseArgs(argvList);
  } catch (cause) {
    process.stderr.write(`${cause.message}\n`);
    return 2;
  }

  if (!existsSync(options.profile)) {
    process.stderr.write(`no profile at ${options.profile}\n`);
    return 2;
  }

  let profile;
  try {
    profile = JSON.parse(readFileSync(options.profile, "utf8"));
  } catch (cause) {
    process.stderr.write(`${options.profile} is not JSON: ${cause.message}\n`);
    return 1;
  }

  const result = validateProfile(profile, { schemaPath: options.schema });
  if (!result.ok) {
    for (const message of result.errors) process.stderr.write(`FAIL  ${message}\n`);
    process.stderr.write(`\nprofile-check failed · ${result.errors.length} problem(s)\n`);
    return 1;
  }

  const apps = profile.apps.map((app) => app.id).join(", ");
  const schema =
    result.schema === "validated"
      ? result.schemaPath
      : "skipped (no local JSON Schema supplied)";
  const name = relative(ROOT, options.profile) || options.profile;
  process.stdout.write(`ok    ${name} · v${profile.v} · ${profile.id} · ${apps}\n`);
  process.stdout.write(
    "ok    gate, build and display match scripts/gate.mjs and scripts/flatpak.mjs\n",
  );
  process.stdout.write(`ok    schema ${schema}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}

export { DISPLAY_COMMAND, GATE_COMMAND, PROFILE_PATH, ROOT, checkProfile, validateProfile };
