import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DISPLAY_COMMAND,
  GATE_COMMAND,
  PROFILE_PATH,
  ROOT,
  validateProfile,
} from "./profile-check.mjs";

const profile = () => JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
const copy = () => structuredClone(profile());
const failures = (value, options = {}) => {
  const result = validateProfile(value, { root: ROOT, env: {}, ...options });
  return result.errors;
};
const schemaDir = join(ROOT, ".dev", "profile-check");

function withSchema(schema, run) {
  mkdirSync(schemaDir, { recursive: true });
  const path = join(schemaDir, "profile.schema.json");
  writeFileSync(path, JSON.stringify(schema));
  try {
    return run(path);
  } finally {
    rmSync(path, { force: true });
  }
}

describe("the Suite app-set profile", () => {
  it("passes the FactoryProfileSchema shape and lists the four queueable apps", () => {
    const result = validateProfile(profile(), { root: ROOT, env: {} });
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(profile().v, 1);
    assert.equal(profile().id, "suite-apps");
    assert.deepEqual(
      profile().apps.map((app) => app.id),
      ["canvas", "planner", "budget", "help"],
    );
  });

  it("skips the optional schema step when no schema file is supplied", () => {
    const result = validateProfile(profile(), { root: ROOT, env: {} });
    assert.equal(result.schema, "skipped");
  });

  it("names the real gate, build and display invocations", () => {
    assert.deepEqual(profile().gate, { command: GATE_COMMAND, fresh: true });
    assert.deepEqual(profile().build, {
      command: ["node", "scripts/flatpak.mjs", "--app", "{app}", "--channel", "slop"],
    });
    assert.deepEqual(profile().display, { command: DISPLAY_COMMAND });
  });

  it("points every app at its package and its own slop build", () => {
    for (const app of profile().apps) {
      assert.deepEqual(Object.keys(app).sort(), ["id", "manifest", "path", "slop_build_path"]);
      assert.equal(app.path, `apps/${app.id}`);
      assert.equal(app.manifest, `apps/${app.id}/package.json`);
      assert.equal(app.slop_build_path, `apps/${app.id}/slop`);
    }
  });

  it("names only toolchain enum values", () => {
    assert.deepEqual(profile().toolchain, [
      "git",
      "node22",
      "pnpm12",
      "docker",
      "xvfb",
      "electron-gtk",
      "flatpak-builder",
      "orca",
    ]);
  });

  it("keeps the release prefix and tier with the app set", () => {
    assert.deepEqual(profile().release, { branch_prefix: "slop/", tier: "slop" });
  });

  it("carries no credential in its env allowlist", () => {
    assert.deepEqual(failures(copy()), []);
    const leaked = copy();
    leaked.env.push("SUITE_STORE_KEY_ID");
    assert.match(failures(leaked).join("\n"), /credential/u);
  });
});

describe("the profile check mirrors FactoryProfileSchema", () => {
  it("refuses the old `version` field and a missing `v`", () => {
    const value = copy();
    delete value.v;
    value.version = 1;
    const messages = failures(value).join("\n");
    assert.match(messages, /v: is required/u);
    assert.match(messages, /version: is not a known field/u);
  });

  it("refuses a string version", () => {
    const value = copy();
    value.v = "1";
    assert.match(failures(value).join("\n"), /v: must be the number 1/u);
  });

  it("refuses an unknown version", () => {
    const value = copy();
    value.v = 2;
    assert.match(failures(value).join("\n"), /unknown version is refused/u);
  });

  it("refuses the old nested apps object", () => {
    const value = copy();
    value.apps = { version: "apps-1", apps: value.apps };
    assert.match(failures(value).join("\n"), /apps: must be a non-empty array/u);
  });

  it("refuses a `ready` field in an app entry", () => {
    const value = copy();
    value.apps[0].ready = true;
    assert.match(failures(value).join("\n"), /apps\[0\]\.ready: is not a known field/u);
  });

  it("refuses an unknown top-level field", () => {
    const value = copy();
    value.extra = true;
    assert.match(failures(value).join("\n"), /extra: is not a known field/u);
  });

  it("refuses an unknown toolchain name or an object toolchain", () => {
    const value = copy();
    value.toolchain[0] = "rust";
    assert.match(failures(value).join("\n"), /toolchain\[0\]: must be one of/u);

    const object = copy();
    object.toolchain = { node: ">=22", pnpm: "12.17.0" };
    assert.match(failures(object).join("\n"), /toolchain: must be a non-empty array/u);
  });

  it("refuses a gate that is a bare array", () => {
    const value = copy();
    value.gate = GATE_COMMAND;
    assert.match(failures(value).join("\n"), /gate: must be an object/u);
  });

  it("refuses `fresh: false`", () => {
    const value = copy();
    value.gate.fresh = false;
    assert.match(failures(value).join("\n"), /gate\.fresh: must be true/u);
  });

  it("refuses a shell string in place of argv", () => {
    const value = copy();
    value.build.command = "node scripts/flatpak.mjs --app {app} --channel slop";
    assert.match(failures(value).join("\n"), /non-empty argv array/u);
  });

  it("refuses a placeholder other than {app}", () => {
    const value = copy();
    value.display.command = ["flatpak", "run", "run.suite.slop.{repo}"];
    assert.match(failures(value).join("\n"), /unknown placeholder \{repo\}/u);
  });

  it("refuses the old release ladder and tag fields", () => {
    const value = copy();
    value.release.ladder = ["slop", "canary", "beta", "stable"];
    value.release.tag = "{tier}-{app}-v{version}";
    const messages = failures(value).join("\n");
    assert.match(messages, /release\.ladder: is not a known field/u);
    assert.match(messages, /release\.tag: is not a known field/u);
  });

  it("refuses a branch prefix without a slash", () => {
    const value = copy();
    value.release.branch_prefix = "slop";
    assert.match(failures(value).join("\n"), /must end in \//u);
  });

  it("refuses a relative guest path and a host home", () => {
    const relativePath = copy();
    relativePath.repo.path = "workspace/suite-apps";
    assert.match(failures(relativePath).join("\n"), /absolute guest path/u);

    const hostHome = copy();
    hostHome.repo.path = "/home/someone/suite-apps";
    assert.match(failures(hostHome).join("\n"), /not a host home/u);
  });

  it("refuses a duplicate app id and an app outside the set", () => {
    const duplicate = copy();
    duplicate.apps[1].id = "canvas";
    duplicate.apps[1].path = "apps/canvas";
    duplicate.apps[1].manifest = "apps/canvas/package.json";
    duplicate.apps[1].slop_build_path = "apps/canvas/slop";
    assert.match(failures(duplicate).join("\n"), /duplicates canvas/u);

    const extra = copy();
    extra.apps.push({
      id: "start",
      path: "apps/start",
      manifest: "apps/start/package.json",
      slop_build_path: "apps/start/slop",
    });
    assert.match(failures(extra).join("\n"), /must list canvas, planner, budget, help/u);
  });

  it("refuses a slop build path outside the app", () => {
    const value = copy();
    value.apps[0].slop_build_path = "packaging/flatpak/.build/run.suite.slop.canvas";
    assert.match(failures(value).join("\n"), /apps\[0\]\.slop_build_path: must be apps\/canvas\/slop/u);
  });

  it("refuses a lowercase environment name", () => {
    const value = copy();
    value.env.push("path");
    assert.match(failures(value).join("\n"), /upper-case environment name/u);
  });

  it("refuses a token anywhere in the profile", () => {
    const value = copy();
    value.build.command = ["echo", "ghp_012345678901234567890123456789"];
    assert.match(failures(value).join("\n"), /looks like a secret/u);
  });
});

describe("the optional local schema", () => {
  const schema = {
    type: "object",
    required: ["v", "id", "repo", "apps", "toolchain", "gate", "build", "release", "display"],
    additionalProperties: false,
    properties: {
      v: { const: 1 },
      id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
      repo: {
        type: "object",
        required: ["url", "ref", "path"],
        properties: {
          url: { type: "string", pattern: "^https://" },
          ref: { type: "string" },
          path: { type: "string" },
        },
      },
      apps: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "path", "manifest", "slop_build_path"],
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            path: { type: "string" },
            manifest: { type: "string" },
            slop_build_path: { type: "string" },
          },
        },
      },
      toolchain: { type: "array", items: { type: "string" }, minItems: 1 },
      gate: { type: "object" },
      build: { type: "object" },
      release: { type: "object" },
      display: { type: "object" },
      env: { type: "array", items: { type: "string" } },
    },
  };

  it("validates the profile against a schema when one is supplied", () => {
    withSchema(schema, (path) => {
      const result = validateProfile(profile(), { root: ROOT, schemaPath: path, env: {} });
      assert.equal(result.schema, "validated");
      assert.deepEqual(result.errors, []);
    });
  });

  it("reports a schema violation", () => {
    withSchema(schema, (path) => {
      const value = copy();
      value.v = "1";
      const result = validateProfile(value, { root: ROOT, schemaPath: path, env: {} });
      assert.equal(result.schema, "validated");
      assert.match(result.errors.join("\n"), /must be 1 \(schema\)/u);
    });
  });

  it("fails when an explicitly named schema does not exist", () => {
    const result = validateProfile(profile(), {
      root: ROOT,
      schemaPath: join(schemaDir, "missing.schema.json"),
      env: {},
    });
    assert.equal(result.schema, "failed");
    assert.match(result.errors.join("\n"), /was named but does not exist/u);
  });
});
