import { type SuiteWidget, suiteWidgetsSchema } from "@suite/contracts/widgets";
import { z } from "zod";
import { PACK_CAPABILITIES, type PackCapability } from "./capabilities.js";
import type { PackContributions } from "./contributions.js";

/**
 * A Suite pack.
 *
 * The manifest is the whole declaration: what the pack is, which entry the host
 * loads, what capabilities it may ask for, what it contributes to the chrome, and
 * the hash of every file. The Ed25519 signature covers the canonical bytes of
 * this manifest; the per-file hashes cover the bytes on disk. Both are required.
 *
 * The same shape is intended for desktop and mobile. A field a host does not know
 * is a reason to refuse the pack, not a reason to ignore it.
 */
export const PACK_FORMAT = "suite.pack";
export const PACK_CONTRACT_VERSION = 1;

const PACK_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const COMMAND_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u;
const MENU_ID = /^[a-z0-9][a-z0-9-]*$/u;
const FILE_EXTENSION = /^\.[a-z0-9][a-z0-9+.-]*$/u;
const DEEP_LINK = /^[a-z0-9][a-z0-9-]*$/u;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const NETWORK_ORIGIN = /^(https|wss):\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function isSafePackId(value: string): boolean {
  return PACK_ID.test(value);
}

/**
 * The one order pack paths are compared in: UTF-16 code units.
 *
 * `localeCompare` puts `ä` beside `a` in one locale and after `z` in another, so a manifest signed
 * on one machine was refused as untrusted on the next. Code-unit order is the same everywhere and
 * needs no collation data, which is what makes canonical bytes canonical.
 */
export function comparePackPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A relative HTML path that cannot leave the pack. */
function isSafeHtmlPath(value: string): boolean {
  return isSafePackPath(value) && value.toLowerCase().endsWith(".html");
}

/** A relative, slash-separated path that cannot leave the pack. */
export function isSafePackPath(value: string): boolean {
  if (value.length === 0 || value.length > 512) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (CONTROL_CHARACTER.test(value)) return false;
  return value
    .split("/")
    .every(
      (segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\"),
    );
}

export interface PackFile {
  readonly path: string;
  /** Lower-case hex. */
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * The publisher whose key signed the pack.
 *
 * The schema requires it. The desktop host still installs manifests signed by the
 * one pinned Suite key and has no publisher trust store, so this parser accepts the
 * field without requiring it until that seam lands.
 */
export interface PackPublisher {
  readonly key: string;
  readonly id?: string;
}

export interface PackDocumentMigration {
  readonly from: number;
  readonly to: number;
  /** A relative HTML path inside the pack. */
  readonly entry: string;
}

/** One document format the pack declares, with its migrations and projection. */
export interface PackDocument {
  readonly id: string;
  readonly format: string;
  readonly version: number;
  readonly mode?: "single" | "multi";
  readonly migrations?: readonly PackDocumentMigration[];
  readonly projection?: string;
  readonly criticalFields?: readonly string[];
}

export type PackBlobClass = "asset" | "derived" | "cache";

export interface PackBlob {
  readonly store: string;
  readonly class: PackBlobClass;
}

export interface PackSync {
  readonly documents?: readonly string[];
  readonly blobs?: readonly string[];
}

export interface PackNetwork {
  readonly allow: readonly string[];
}

export type PackPlatform = "desktop" | "mobile";
export type PackInput = "pointer" | "touch" | "keyboard";

/** The slice of a document a widget may read or write. */
export interface PackWidgetData {
  readonly scope: "projection" | "scoped" | "full";
  readonly read?: readonly string[];
  readonly write?: readonly string[];
}

/** A widget whose interface is signed code, with a declarative fallback. */
export interface PackCodeWidget {
  readonly id: string;
  readonly title: string;
  readonly size: "1x1" | "2x1" | "full";
  readonly capabilities: readonly "capture"[];
  readonly action: Readonly<Record<string, unknown>>;
  readonly settings?: readonly Readonly<Record<string, unknown>>[];
  readonly data?: PackWidgetData;
  readonly entry: string;
  readonly sha256: string;
  readonly fallback: {
    readonly id: string;
    readonly title: string;
    readonly size: "1x1" | "2x1" | "full";
    readonly capabilities: readonly "capture"[];
    readonly action: Readonly<Record<string, unknown>>;
    readonly settings?: readonly Readonly<Record<string, unknown>>[];
    readonly data?: PackWidgetData;
  };
}

export type PackComponentKind = "map" | "video" | "camera" | "model3d" | "ar.surface";

/** A native surface the host may draw, or fall back to the web. */
export interface PackComponent {
  readonly kind: PackComponentKind;
  readonly fallback: "web" | "none";
}

/** A lazy entry that shares this pack's signature, origin and capabilities. */
export interface PackSubpackage {
  readonly id: string;
  readonly entry: string;
}

/** A separately signed artifact this pack pins. */
export interface PackAddon {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
}

export interface PackExport {
  readonly entry: string;
}

export interface PackManifestCore {
  readonly format: typeof PACK_FORMAT;
  readonly id: string;
  readonly name: string;
  /**
   * One line for the launcher. Optional, and absent from the canonical bytes
   * when a manifest does not carry it, so an older signature still verifies.
   */
  readonly description?: string;
  readonly version: string;
  readonly entry: string;
  readonly contractVersion: number;
  readonly minimumHostVersion?: number;
  readonly publisher?: PackPublisher;
  readonly capabilities: readonly PackCapability[];
  readonly optionalCapabilities?: readonly PackCapability[];
  readonly documents?: readonly PackDocument[];
  readonly blobs?: readonly PackBlob[];
  readonly sync?: PackSync;
  readonly network?: PackNetwork;
  readonly platforms?: readonly PackPlatform[];
  readonly input?: readonly PackInput[];
  readonly defaultLocale?: string;
  readonly locales?: readonly string[];
  readonly contributions?: PackContributions;
  readonly widgets?: readonly SuiteWidget[];
  readonly codeWidgets?: readonly PackCodeWidget[];
  readonly components?: readonly PackComponent[];
  readonly subpackages?: readonly PackSubpackage[];
  readonly addons?: readonly PackAddon[];
  readonly export?: PackExport;
  readonly license?: string;
  readonly source?: string;
  readonly deprecated?: boolean;
  readonly replacement?: string;
  readonly sunset?: string;
  readonly files: readonly PackFile[];
}

export interface PackManifest extends PackManifestCore {
  /** Base64 Ed25519 signature over `canonicalManifestBytes(manifest)`. */
  readonly signature: string;
}

export interface PackIssue {
  readonly path: string;
  readonly message: string;
}

export type PackParse =
  | { readonly ok: true; readonly value: PackManifest }
  | { readonly ok: false; readonly issues: readonly PackIssue[] };

const fileSchema = z
  .object({
    path: z.string().refine(isSafePackPath, "a relative path inside the pack"),
    sha256: z.string().regex(SHA256_HEX),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

const commandSchema = z
  .object({
    id: z.string().regex(COMMAND_ID),
    title: z.string().min(1).max(80),
    category: z.string().min(1).max(40).optional(),
    keybinding: z.string().min(1).max(80).optional(),
  })
  .strict();

const menuSchema = z
  .object({
    menu: z.string().regex(MENU_ID),
    command: z.string().regex(COMMAND_ID),
    label: z.string().min(1).max(80).optional(),
    group: z.string().min(1).max(40).optional(),
    when: z.string().min(1).max(200).optional(),
  })
  .strict();

const contributionsSchema = z
  .object({
    commands: z.array(commandSchema).max(200).optional(),
    menus: z.array(menuSchema).max(500).optional(),
    fileExtensions: z.array(z.string().regex(FILE_EXTENSION)).max(32).optional(),
    deepLinks: z.array(z.string().regex(DEEP_LINK)).max(32).optional(),
  })
  .strict();

function unique<T>(items: readonly T[]): boolean {
  return new Set(items).size === items.length;
}

const publisherSchema = z
  .object({
    key: z.string().min(32),
    id: z.string().min(1).max(64).optional(),
  })
  .strict();

const documentSchema = z
  .object({
    id: z.string().regex(PACK_ID),
    format: z.string().min(1),
    version: z.number().int().positive(),
    mode: z.enum(["single", "multi"]).optional(),
    migrations: z
      .array(
        z
          .object({
            from: z.number().int().positive(),
            to: z.number().int().positive(),
            entry: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    projection: z.string().min(1).optional(),
    criticalFields: z.array(z.string().min(1)).optional(),
  })
  .strict();

const blobSchema = z
  .object({
    store: z.string().regex(PACK_ID),
    class: z.enum(["asset", "derived", "cache"]),
  })
  .strict();

const uniqueIds = z.array(z.string().min(1)).refine(unique, "duplicate item");

const syncSchema = z
  .object({
    documents: uniqueIds.optional(),
    blobs: uniqueIds.optional(),
  })
  .strict();

const networkSchema = z
  .object({
    allow: z
      .array(z.string().regex(NETWORK_ORIGIN))
      .min(1)
      .max(64)
      .refine(unique, "duplicate item"),
  })
  .strict();

const platformsSchema = z
  .array(z.enum(["desktop", "mobile"]))
  .min(1)
  .refine(unique, "duplicate item");

const inputSchema = z
  .array(z.enum(["pointer", "touch", "keyboard"]))
  .min(1)
  .refine(unique, "duplicate item");

const localesSchema = z.array(z.string().regex(LOCALE)).refine(unique, "duplicate item");

const widgetDataSchema = z
  .object({
    scope: z.enum(["projection", "scoped", "full"]),
    read: z.array(z.string().min(1)).optional(),
    write: z.array(z.string().min(1)).optional(),
  })
  .strict();

const widgetDescriptorSchema = z
  .object({
    id: z.string().regex(PACK_ID),
    title: z.string().min(1).max(60),
    size: z.enum(["1x1", "2x1", "full"]),
    capabilities: z.array(z.enum(["capture"])),
    action: z.record(z.string(), z.unknown()),
    settings: z.array(z.record(z.string(), z.unknown())).optional(),
    data: widgetDataSchema.optional(),
  })
  .strict();

const codeWidgetSchema = widgetDescriptorSchema
  .extend({
    entry: z.string().refine(isSafeHtmlPath, "a relative HTML path inside the pack"),
    sha256: z.string().regex(SHA256_HEX),
    fallback: widgetDescriptorSchema,
  })
  .strict();

const componentSchema = z
  .object({
    kind: z.enum(["map", "video", "camera", "model3d", "ar.surface"]),
    fallback: z.enum(["web", "none"]),
  })
  .strict();

const subpackageSchema = z
  .object({
    id: z.string().regex(PACK_ID),
    entry: z.string().refine(isSafeHtmlPath, "a relative HTML path inside the pack"),
  })
  .strict();

const addonSchema = z
  .object({
    id: z.string().regex(PACK_ID),
    version: z.string().regex(SEMVER),
    sha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const exportSchema = z
  .object({
    entry: z.string().min(1),
  })
  .strict();

function manifestSchema(requireSignature: boolean) {
  return z
    .object({
      format: z.literal(PACK_FORMAT),
      id: z.string().regex(PACK_ID),
      name: z.string().min(1).max(64),
      description: z.string().min(1).max(200).optional(),
      version: z.string().regex(SEMVER),
      entry: z.string().refine(isSafePackPath, "a relative path inside the pack"),
      contractVersion: z.number().int().positive(),
      minimumHostVersion: z.number().int().positive().optional(),
      publisher: publisherSchema.optional(),
      capabilities: z.array(z.enum(PACK_CAPABILITIES)).default([]),
      optionalCapabilities: z.array(z.enum(PACK_CAPABILITIES)).optional(),
      documents: z.array(documentSchema).max(64).optional(),
      blobs: z.array(blobSchema).max(64).optional(),
      sync: syncSchema.optional(),
      network: networkSchema.optional(),
      platforms: platformsSchema.optional(),
      input: inputSchema.optional(),
      defaultLocale: z.string().regex(LOCALE).optional(),
      locales: localesSchema.optional(),
      contributions: contributionsSchema.optional(),
      widgets: suiteWidgetsSchema.optional(),
      codeWidgets: z.array(codeWidgetSchema).max(64).optional(),
      components: z.array(componentSchema).max(16).optional(),
      subpackages: z.array(subpackageSchema).max(64).optional(),
      addons: z.array(addonSchema).max(64).optional(),
      export: exportSchema.optional(),
      license: z.string().min(1).max(64).optional(),
      source: z
        .string()
        .regex(/^https:\/\//u)
        .optional(),
      deprecated: z.boolean().optional(),
      replacement: z.string().min(1).max(64).optional(),
      sunset: z.string().regex(ISO_DATE).optional(),
      files: z.array(fileSchema).min(1).max(2048),
      signature: requireSignature ? z.string().min(1) : z.string().min(1).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const files = new Set<string>();
      value.files.forEach((file, index) => {
        if (files.has(file.path)) {
          context.addIssue({
            code: "custom",
            path: ["files", index, "path"],
            message: `duplicate path ${file.path}`,
          });
        }
        files.add(file.path);
      });
      if (!files.has(value.entry)) {
        context.addIssue({
          code: "custom",
          path: ["entry"],
          message: "must name a file the manifest lists",
        });
      }
      if (!value.entry.toLowerCase().endsWith(".html")) {
        context.addIssue({
          code: "custom",
          path: ["entry"],
          message: "a pack entry is an HTML document",
        });
      }

      const capabilities = new Set<string>();
      value.capabilities.forEach((capability, index) => {
        if (capabilities.has(capability)) {
          context.addIssue({
            code: "custom",
            path: ["capabilities", index],
            message: `duplicate ${capability}`,
          });
        }
        capabilities.add(capability);
      });

      if (value.contributions !== undefined) {
        const commands = new Set<string>();
        value.contributions.commands?.forEach((command, index) => {
          if (commands.has(command.id)) {
            context.addIssue({
              code: "custom",
              path: ["contributions", "commands", index, "id"],
              message: `duplicate command ${command.id}`,
            });
          }
          commands.add(command.id);
        });

        uniqueStrings(
          value.contributions.fileExtensions,
          ["contributions", "fileExtensions"],
          context,
        );
        uniqueStrings(value.contributions.deepLinks, ["contributions", "deepLinks"], context);
      }
    });
}

function uniqueStrings(
  values: readonly string[] | undefined,
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  if (values === undefined) return;
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `duplicate ${value}`,
      });
    }
    seen.add(value);
  });
}

export function parsePackManifest(value: unknown): PackParse {
  const parsed = manifestSchema(true).safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, value: parsed.data as PackManifest };
}

/**
 * Parse `manifest.json` text, refusing a duplicate key before `JSON.parse` sees it.
 *
 * `JSON.parse` keeps the last of two identical keys without a word, so a manifest could show one
 * `entry` or `signature` to a verifier and another to whatever reads it next. That is a signature
 * bypass, not a formatting wart. The scan walks the raw text, decodes string escapes, and reports
 * the second key with its path; only a text with no duplicate keys reaches the parser.
 */
export function parsePackManifestJson(text: string): PackParse {
  const duplicate = findDuplicateJsonKey(text);
  if (duplicate !== null) {
    return {
      ok: false,
      issues: [
        {
          path: duplicate.path,
          message: `duplicate key ${JSON.stringify(duplicate.key)}`,
        },
      ],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          message: error instanceof Error ? error.message : "not valid JSON",
        },
      ],
    };
  }
  return parsePackManifest(value);
}

interface DuplicateJsonKey {
  readonly key: string;
  readonly path: string;
}

type JsonFrame =
  | { readonly kind: "object"; readonly path: readonly string[]; readonly keys: Set<string> }
  | { readonly kind: "array"; readonly path: readonly string[]; index: number };

function isJsonWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\n" || character === "\r" || character === "\t";
}

/** A duplicate key in raw JSON text, or `null`. Invalid JSON is left to `JSON.parse` to refuse. */
function findDuplicateJsonKey(text: string): DuplicateJsonKey | null {
  const frames: JsonFrame[] = [];
  let pendingKey: string | null = null;
  let index = 0;

  const parentPath = (): readonly string[] => {
    const parent = frames[frames.length - 1];
    if (parent === undefined) return [];
    if (parent.kind === "array") return [...parent.path, String(parent.index)];
    return pendingKey === null ? parent.path : [...parent.path, pendingKey];
  };

  const skipWhitespace = (): void => {
    while (isJsonWhitespace(text[index])) index += 1;
  };

  const readString = (): string => {
    // `index` names the opening quote.
    index += 1;
    let value = "";
    while (index < text.length) {
      const character = text[index] as string;
      if (character === '"') {
        index += 1;
        return value;
      }
      if (character !== "\\") {
        value += character;
        index += 1;
        continue;
      }
      const escaped = text[index + 1];
      index += 2;
      switch (escaped) {
        case '"':
          value += '"';
          break;
        case "\\":
          value += "\\";
          break;
        case "/":
          value += "/";
          break;
        case "b":
          value += "\b";
          break;
        case "f":
          value += "\f";
          break;
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "u": {
          const code = text.slice(index, index + 4);
          if (/^[0-9A-Fa-f]{4}$/u.test(code)) {
            value += String.fromCharCode(Number.parseInt(code, 16));
            index += 4;
          }
          break;
        }
        default:
          break;
      }
    }
    return value;
  };

  while (index < text.length) {
    skipWhitespace();
    const character = text[index];
    if (character === undefined) break;

    if (character === "{" || character === "[") {
      const path = parentPath();
      if (character === "{") {
        frames.push({ kind: "object", path, keys: new Set() });
      } else {
        frames.push({ kind: "array", path, index: 0 });
      }
      pendingKey = null;
      index += 1;
      continue;
    }

    if (character === "}" || character === "]") {
      frames.pop();
      pendingKey = null;
      index += 1;
      continue;
    }

    if (character === ",") {
      const frame = frames[frames.length - 1];
      if (frame?.kind === "array") frame.index += 1;
      pendingKey = null;
      index += 1;
      continue;
    }

    if (character === ":") {
      index += 1;
      continue;
    }

    if (character === '"') {
      const value = readString();
      let ahead = index;
      while (isJsonWhitespace(text[ahead])) ahead += 1;
      if (text[ahead] === ":") {
        const frame = frames[frames.length - 1];
        if (frame?.kind === "object") {
          if (frame.keys.has(value)) {
            return { key: value, path: [...frame.path, value].join(".") };
          }
          frame.keys.add(value);
        }
        pendingKey = value;
        index = ahead + 1;
      }
      continue;
    }

    // A number or one of `true`, `false`, `null`: skip it. `JSON.parse` judges its shape.
    index += 1;
  }

  return null;
}

/**
 * A manifest field order that never changes.
 *
 * S3.3 makes the canonical bytes a fixed field order. The order is the schema's, minus `signature`,
 * so a reader can compare the two lists directly. Nested objects are rebuilt with code-unit-sorted
 * keys for the same reason: a signature may not depend on the order a JSON author happened to use.
 */
const MANIFEST_FIELD_ORDER: readonly (keyof PackManifestCore)[] = [
  "format",
  "id",
  "name",
  "description",
  "version",
  "entry",
  "contractVersion",
  "minimumHostVersion",
  "publisher",
  "capabilities",
  "optionalCapabilities",
  "documents",
  "blobs",
  "sync",
  "network",
  "platforms",
  "input",
  "defaultLocale",
  "locales",
  "widgets",
  "codeWidgets",
  "components",
  "contributions",
  "subpackages",
  "addons",
  "export",
  "license",
  "source",
  "deprecated",
  "replacement",
  "sunset",
  "files",
];

/**
 * The exact bytes a signature covers.
 *
 * Built field by field in the schema's order, not by `JSON.stringify(manifest)`, so a signature
 * verifies on every host. An optional field that is absent contributes no key at all: `null` is not
 * a value the schema accepts, and emitting it would sign a different document from the one that was
 * written. Capabilities (required and optional) and files are sorted by code unit, never by locale;
 * command, menu, document and widget order is preserved because it is an authoring decision.
 *
 * Ed25519 over these bytes follows RFC 8032 and the signature travels as standard base64; see
 * `signPackManifest` and `verifyPackSignature`.
 */
export function canonicalManifestBytes(manifest: PackManifestCore): Uint8Array {
  const canonical: Record<string, unknown> = {};
  for (const field of MANIFEST_FIELD_ORDER) {
    const value = manifest[field];
    if (value === undefined) continue;

    if (field === "capabilities" || field === "optionalCapabilities") {
      canonical[field] = [...new Set(value as readonly string[])].sort(comparePackPaths);
    } else if (field === "files") {
      canonical.files = (value as readonly PackFile[])
        .map((file) => canonicalJsonValue(file) as { path: string })
        .sort((left, right) => comparePackPaths(left.path, right.path));
    } else if (field === "contributions") {
      canonical.contributions = canonicalContributions(value as PackContributions);
    } else {
      canonical[field] = canonicalJsonValue(value);
    }
  }
  return new TextEncoder().encode(JSON.stringify(canonical));
}

/** Rebuild an object with code-unit-sorted keys, dropping only `undefined`. */
function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(comparePackPaths)) {
      if (source[key] === undefined) continue;
      ordered[key] = canonicalJsonValue(source[key]);
    }
    return ordered;
  }
  return value;
}

/** Contribution order is authored, except the two path sets, which are sorted like files. */
function canonicalContributions(contributions: PackContributions): Record<string, unknown> {
  const canonical = canonicalJsonValue(contributions) as Record<string, unknown>;
  for (const field of ["fileExtensions", "deepLinks"]) {
    const list = canonical[field];
    if (Array.isArray(list)) {
      canonical[field] = [...new Set(list)].sort(comparePackPaths);
    }
  }
  return canonical;
}

export interface HostContract {
  readonly contractVersion: number;
  readonly hostVersion: number;
}

export type HostFit =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "contract" | "host"; readonly message: string };

export function packFitsHost(manifest: PackManifestCore, host: HostContract): HostFit {
  if (manifest.contractVersion > host.contractVersion) {
    return {
      ok: false,
      reason: "contract",
      message: `${manifest.name} needs pack contract ${manifest.contractVersion}; this host implements ${host.contractVersion}.`,
    };
  }
  if (manifest.minimumHostVersion !== undefined && manifest.minimumHostVersion > host.hostVersion) {
    return {
      ok: false,
      reason: "host",
      message: `${manifest.name} needs host ${manifest.minimumHostVersion}; this host is ${host.hostVersion}.`,
    };
  }
  return { ok: true };
}

export function packAllows(
  manifest: Pick<PackManifestCore, "capabilities">,
  capability: PackCapability,
): boolean {
  return manifest.capabilities.includes(capability);
}
