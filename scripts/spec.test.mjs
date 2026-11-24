/**
 * The spec's own check: clause coverage, ledger evidence, spec tags, schema coherence and the
 * fixture corpus.
 *
 * Dependency-free on purpose. It validates the JSON Schema subset the manifest uses, so the prose,
 * the schema and the fixtures cannot drift without this failing.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC = readFileSync(join(ROOT, "docs", "spec", "superapp.md"), "utf8");
const LEDGER = readFileSync(join(ROOT, "docs", "spec", "ledger.md"), "utf8");
const SCHEMA = JSON.parse(
  readFileSync(join(ROOT, "docs", "spec", "manifest.schema.json"), "utf8"),
);
const FIXTURES = JSON.parse(
  readFileSync(join(ROOT, "docs", "spec", "fixtures.json"), "utf8"),
);

/** The statuses the ledger may use. `Implemented` is a claim; the others name what is missing. */
const STATUSES = ["Implemented", "Partial", "Absent", "Future"];

/**
 * The test files that may carry `// spec: S4.2`. Kept small and explicit: these are the files the
 * gate already runs that could plausibly cover a clause. A tag in an unlisted file is unchecked.
 */
const TAG_SCAN_FILES = [
  "scripts/spec.test.mjs",
  "scripts/spec-golden.test.mjs",
  "scripts/pack.test.mjs",
  "scripts/budget-pack.test.mjs",
  "scripts/affected.test.mjs",
  "scripts/release-manifest.test.mjs",
  "scripts/channel.test.mjs",
  "scripts/shell-channel.test.mjs",
  "scripts/android-release.test.mjs",
  "scripts/release-status.test.mjs",
  "scripts/delivery-signals.test.mjs",
  "scripts/flatpak-remote.test.mjs",
  "packages/pack/src/manifest.test.ts",
  "packages/pack/src/signature.test.ts",
  "packages/pack/src/trust.test.ts",
  "packages/pack-host/src/archive.test.ts",
  "apps/shell/src/documentMigrations.test.ts",
  "apps/shell/src/blobs.test.ts",
  "apps/shell/src/exportBundle.test.ts",
  "apps/shell/src/installedPacks.test.ts",
  "apps/shell/src/packIdentity.test.ts",
  "apps/shell/src/publisherTrust.test.ts",
];

function resolveRef(ref) {
  assert.match(ref, /^#\//u, `unsupported $ref ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((node, key) => {
      assert.ok(node !== undefined, `unresolved $ref ${ref}`);
      return node[key];
    }, SCHEMA);
}

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

/** The JSON Schema subset in `manifest.schema.json`. */
function validate(schema, value, path = "$") {
  const errors = [];
  if (schema.$ref !== undefined) {
    return validate(resolveRef(schema.$ref), value, path);
  }

  if (schema.type !== undefined) {
    const actual = typeOf(value);
    const wanted = schema.type;
    const matches =
      wanted === "number" ? actual === "number" || actual === "integer" : actual === wanted;
    if (!matches) {
      errors.push(`${path}: expected ${wanted}, got ${actual}`);
      return errors;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: not one of ${schema.enum.join(", ")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: shorter than ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: longer than ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${path}: does not match ${schema.pattern}`);
    }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: below ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: fewer than ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: more than ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) errors.push(`${path}: duplicate items`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => errors.push(...validate(schema.items, item, `${path}[${index}]`)));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing ${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child === undefined) {
        if (schema.additionalProperties === false) {
          errors.push(`${path}: unknown field ${key}`);
        } else if (typeof schema.additionalProperties === "object") {
          errors.push(...validate(schema.additionalProperties, item, `${path}.${key}`));
        }
        continue;
      }
      errors.push(...validate(child, item, `${path}.${key}`));
    }
  }

  return errors;
}

function expandRange(range) {
  const [start, end] = range.split(/[–-]/u);
  if (end === undefined) return [start];
  const startMatch = /^S(\d+)\.(\d+)$/u.exec(start);
  const endMatch = /^S(\d+)\.(\d+)$/u.exec(end);
  assert.ok(startMatch !== null && endMatch !== null, `bad range ${range}`);
  assert.equal(startMatch[1], endMatch[1], `range crosses sections: ${range}`);
  return Array.from(
    { length: Number(endMatch[2]) - Number(startMatch[2]) + 1 },
    (_, index) => `S${startMatch[1]}.${Number(startMatch[2]) + index}`,
  );
}

function clauseIds(text) {
  return [...text.matchAll(/\*\*(S\d+\.\d+)\*\*/gu)].map((match) => match[1]);
}

/**
 * The ledger's main table, one object per row. Parsing is status-agnostic so an unknown status is
 * reported by the status check instead of silently dropping the row from coverage.
 */
function ledgerRows(text) {
  const rows = [];
  for (const match of text
    .split("## Blocking gaps")[0]
    .matchAll(
      /^\| (S\d+\.\d+(?:[–-]S\d+\.\d+)?) \| ([^|]+) \| ([^|]+) \| (.*?) \|$/gmu,
    )) {
    rows.push({
      clauses: expandRange(match[1]),
      status: match[3].trim(),
      evidence: match[4].trim(),
    });
  }
  return rows;
}

function ledgerIds(text) {
  return ledgerRows(text).flatMap((row) => row.clauses);
}

/** A token that names a place in the tree rather than a concept. */
function isPathLike(token) {
  if (token.includes("://")) return false;
  if (token.startsWith("@suite/")) return true;
  if (token.includes("/")) return true;
  return /^[\w.-]+\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml)$/u.test(token);
}

/** Backticked and bare path citations in an evidence cell, deduplicated in source order. */
function citedPaths(evidence) {
  const citations = [];
  for (const match of evidence.matchAll(/`([^`]+)`/gu)) {
    const token = match[1].trim();
    if (isPathLike(token)) citations.push(token);
  }
  // Bare citations are only paths when they look like files; prose such as "Shell/Go" is not one.
  for (const match of evidence.matchAll(
    /(?:^|[\s(])(@suite\/[A-Za-z0-9_.-]+|[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml))(?=$|[\s),.;:])/gu,
  )) {
    if (isPathLike(match[1])) citations.push(match[1]);
  }
  return [...new Set(citations)];
}

let fileIndex = null;

/** Find a filename cited without a directory, without walking the generated output. */
function findFileNamed(name) {
  if (fileIndex === null) {
    fileIndex = new Map();
    const skip = new Set([
      "node_modules",
      "dist",
      ".git",
      ".generated",
      ".turbo",
      "build",
      "coverage",
    ]);
    const walk = (relative) => {
      for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
        const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) walk(child);
        } else if (!fileIndex.has(entry.name)) {
          fileIndex.set(entry.name, child);
        }
      }
    };
    for (const base of ["scripts", "packages", "apps", "docs"]) walk(base);
  }
  return fileIndex.get(name) ?? null;
}

/** Whether an evidence citation points at something that exists today. */
function resolvesCitation(citation) {
  const token = citation.replace(/[.,;:]+$/u, "");
  if (token.startsWith("@suite/")) {
    const name = token.slice("@suite/".length);
    return ["packages", "apps"].some((base) => existsSync(join(ROOT, base, name)));
  }
  if (existsSync(join(ROOT, token))) return true;
  if (!token.includes("/")) return findFileNamed(token) !== null;
  return false;
}

/** `// spec: S4.2` tags in a test file. */
function specTags(text) {
  return [...text.matchAll(/^\s*\/\/\s*spec:\s*(S\d+\.\d+)\b/gmu)].map((match) => match[1]);
}

/** Tags that name no clause in the spec, or a clause with no ledger row. */
function unknownSpecTags(text, clauses, ledger) {
  return specTags(text).filter((tag) => !clauses.has(tag) || !ledger.has(tag));
}

function fixtureVariant(fixture) {
  const manifest = structuredClone(FIXTURES.valid);
  for (const key of fixture.delete ?? []) delete manifest[key];
  Object.assign(manifest, fixture.set ?? {});
  return manifest;
}

describe("the superapp spec", () => {
  it("gives every clause an ID and one ledger row", () => {
    const spec = clauseIds(SPEC);
    const ledger = ledgerIds(LEDGER);
    assert.equal(new Set(spec).size, spec.length, "duplicate clause ID in the spec");
    assert.deepEqual([...new Set(ledger)].sort(), [...spec].sort());
    assert.equal(new Set(ledger).size, ledger.length, "duplicate clause in the ledger");
  });

  // spec: S16.1
  it("records only known statuses", () => {
    for (const row of ledgerRows(LEDGER)) {
      assert.ok(
        STATUSES.includes(row.status),
        `${row.clauses.join(", ")}: status ${JSON.stringify(row.status)} is not one of ${STATUSES.join(", ")}`,
      );
    }
  });

  // spec: S16.3
  it("gives every implemented clause evidence it can point at", () => {
    for (const row of ledgerRows(LEDGER)) {
      if (row.status !== "Implemented") continue;
      assert.ok(
        row.evidence.length > 0 && !/^(?:[-—]|n\/?a|none|todo|tbd)\.?$/iu.test(row.evidence),
        `${row.clauses.join(", ")}: implemented with no evidence`,
      );
      for (const citation of citedPaths(row.evidence)) {
        assert.ok(
          resolvesCitation(citation),
          `${row.clauses.join(", ")}: evidence cites ${citation}, which does not exist`,
        );
      }
    }
  });

  // spec: S16.3
  it("points every spec tag at a clause with a ledger row", () => {
    const clauses = new Set(clauseIds(SPEC));
    const ledger = new Set(ledgerIds(LEDGER));
    for (const file of TAG_SCAN_FILES) {
      assert.ok(existsSync(join(ROOT, file)), `tag scan list is stale: ${file} is gone`);
      const unknown = unknownSpecTags(readFileSync(join(ROOT, file), "utf8"), clauses, ledger);
      assert.deepEqual(
        unknown,
        [],
        `${file}: ${unknown.join(", ")} is not a clause with a ledger row`,
      );
    }
    // The check refuses an unknown clause and accepts a known one; no real file is edited to prove it.
    assert.deepEqual(unknownSpecTags("// spec: S99.1\n// spec: S3.4\n", clauses, ledger), ["S99.1"]);
  });

  it("names the schema, ledger, fixtures and agent order", () => {
    for (const target of ["README.md", "manifest.schema.json", "ledger.md", "AGENTS.md", "fixtures.json"]) {
      assert.ok(SPEC.includes(`(${target})`) || SPEC.includes(`[${target}]`), `spec does not link ${target}`);
    }
    assert.match(SPEC, /\bMUST\b/u);
    assert.match(SPEC, /\bSHOULD\b/u);
  });

  it("keeps the schema versioned and the capability vocabulary current", () => {
    assert.equal(SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(SCHEMA.$id, /\/0\.1\//u);
    assert.equal(SCHEMA.properties.format.const, "suite.pack");
    for (const required of SCHEMA.required) {
      assert.ok(required in SCHEMA.properties, `${required} is required but not declared`);
    }
    const capabilities = SCHEMA.$defs.capability.enum;
    for (const current of [
      "documents",
      "storage",
      "files",
      "recents",
      "notifications",
      "network",
      "relay",
      "commands",
      "identity.pack",
      "sync",
    ]) {
      assert.ok(capabilities.includes(current), `missing capability ${current}`);
    }
    assert.ok(!capabilities.includes("identity.device"), "the device key must not be a pack capability");
  });

  it("accepts the valid manifest", () => {
    assert.deepEqual(validate(SCHEMA, FIXTURES.valid), []);
  });

  it("keeps the valid fixture internally consistent", () => {
    const files = new Set(FIXTURES.valid.files.map((file) => file.path));
    assert.ok(files.has(FIXTURES.valid.entry), "entry is not in files");
    for (const widget of FIXTURES.valid.codeWidgets ?? []) {
      assert.ok(files.has(widget.entry), `code widget ${widget.id} entry is not in files`);
    }
    for (const subpackage of FIXTURES.valid.subpackages ?? []) {
      assert.ok(files.has(subpackage.entry), `subpackage ${subpackage.id} entry is not in files`);
    }
    assert.ok(files.has(FIXTURES.valid.export.entry), "export entry is not in files");

    const unique = (items, label) => {
      const ids = (items ?? []).map((item) => item.id);
      assert.equal(new Set(ids).size, ids.length, `duplicate ${label} id`);
    };
    unique(FIXTURES.valid.documents, "document");
    unique(FIXTURES.valid.widgets, "widget");
    unique(FIXTURES.valid.codeWidgets, "code widget");
    unique(FIXTURES.valid.subpackages, "subpackage");
    unique(FIXTURES.valid.addons, "add-on");

    const required = new Set(FIXTURES.valid.capabilities);
    for (const optional of FIXTURES.valid.optionalCapabilities ?? []) {
      assert.ok(!required.has(optional), `${optional} is both required and optional`);
    }
  });

  it("refuses every invalid fixture and names a real clause", () => {
    const spec = new Set(clauseIds(SPEC));
    for (const fixture of FIXTURES.invalid) {
      assert.ok(spec.has(fixture.clause), `${fixture.name}: unknown clause ${fixture.clause}`);
      const errors = validate(SCHEMA, fixtureVariant(fixture));
      assert.ok(errors.length > 0, `${fixture.name}: expected a refusal`);
    }
  });
});
