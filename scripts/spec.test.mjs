/**
 * The spec's own check: the schema is coherent, a representative manifest validates, a missing or
 * unknown field is refused, and every section has a ledger row.
 *
 * This is deliberately dependency-free. It validates the small JSON Schema subset the manifest uses,
 * so the schema and the fixture cannot drift from the prose without this failing.
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

const SHA = "a".repeat(64);

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

/** The JSON Schema subset in `manifest.schema.json`: type, properties, required, items, enum, const,
 * pattern, minimum, min/max length, minItems, uniqueItems and additionalProperties. */
function validate(schema, value, path = "$") {
  const errors = [];
  if (schema.$ref !== undefined) {
    return validate(resolveRef(schema.$ref), value, path);
  }

  if (schema.type !== undefined) {
    const actual = typeOf(value);
    const wanted = schema.type;
    const matches = wanted === "number" ? actual === "number" || actual === "integer" : actual === wanted;
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

const validManifest = {
  format: "suite.pack",
  id: "chart",
  name: "Chart",
  version: "1.2.0",
  entry: "index.html",
  contractVersion: 2,
  capabilities: ["documents", "network", "sync"],
  documents: [{ id: "chart", format: "suite.chart", version: 1, mode: "single" }],
  blobs: [{ store: "assets", class: "asset" }],
  sync: { documents: ["chart"], blobs: ["assets"] },
  network: { allow: ["https://api.example.com"] },
  platforms: ["desktop", "mobile"],
  input: ["pointer", "touch", "keyboard"],
  files: [{ path: "index.html", sha256: SHA, bytes: 12 }],
  signature: "c2lnbmF0dXJl",
};

describe("the superapp spec", () => {
  it("has one ledged row per section and no extra rows", () => {
    const sections = [...SPEC.matchAll(/^## (\d+)\./gmu)].map((match) => match[1]);
    const rows = [...LEDGER.matchAll(/^\| (\d+) \|/gmu)].map((match) => match[1]);
    assert.deepEqual(sections, Array.from({ length: sections.length }, (_, i) => String(i + 1)));
    assert.deepEqual([...rows].sort(), [...sections].sort());
  });

  it("names the schema, ledger and orientation", () => {
    for (const target of ["README.md", "manifest.schema.json", "ledger.md"]) {
      assert.ok(SPEC.includes(`(${target})`), `spec does not link ${target}`);
    }
    assert.match(SPEC, /\bMUST\b/u);
    assert.match(SPEC, /\bSHOULD\b/u);
  });

  it("keeps the schema and the current capability vocabulary aligned", () => {
    assert.equal(SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(SCHEMA.properties.format.const, "suite.pack");
    for (const required of SCHEMA.required) {
      assert.ok(required in SCHEMA.properties, `${required} is required but not declared`);
    }
    const capabilities = SCHEMA.properties.capabilities.items.enum;
    for (const current of [
      "documents",
      "storage",
      "files",
      "recents",
      "notifications",
      "network",
      "relay",
      "commands",
    ]) {
      assert.ok(capabilities.includes(current), `missing current capability ${current}`);
    }
  });

  it("accepts a complete manifest", () => {
    assert.deepEqual(validate(SCHEMA, validManifest), []);
  });

  it("refuses a missing signature, an unknown field and a bad origin", () => {
    const noSignature = { ...validManifest };
    delete noSignature.signature;
    assert.match(validate(SCHEMA, noSignature).join("\n"), /missing signature/u);

    assert.match(
      validate(SCHEMA, { ...validManifest, telemetry: true }).join("\n"),
      /unknown field telemetry/u,
    );

    assert.match(
      validate(SCHEMA, {
        ...validManifest,
        network: { allow: ["http://api.example.com"] },
      }).join("\n"),
      /does not match/u,
    );
  });

  it("refuses an unknown capability", () => {
    assert.match(
      validate(SCHEMA, { ...validManifest, capabilities: ["documents", "root"] }).join("\n"),
      /not one of/u,
    );
  });
});
