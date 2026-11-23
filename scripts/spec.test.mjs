/**
 * The spec's own check: clause coverage, schema coherence and the fixture corpus.
 *
 * Dependency-free on purpose. It validates the JSON Schema subset the manifest uses, so the prose,
 * the schema and the fixtures cannot drift without this failing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

function ledgerIds(text) {
  const ids = [];
  for (const match of text.matchAll(
    /^\| (S\d+\.\d+(?:[–-]S\d+\.\d+)?) \| [^|]+ \| (Implemented|Partial|Absent|Future) \|/gmu,
  )) {
    ids.push(...expandRange(match[1]));
  }
  return ids;
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

  it("records only known statuses", () => {
    const table = LEDGER.split("## Blocking gaps")[0];
    for (const match of table.matchAll(/^\| S[\d.]+(?:[–-]S[\d.]+)? \| [^|]+ \| ([^|]+) \|/gmu)) {
      assert.match(match[1].trim(), /^(Implemented|Partial|Absent|Future)$/u);
    }
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
