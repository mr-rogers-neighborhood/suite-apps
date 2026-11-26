import {
  packCommandContributionSchema,
  packProviderContributionSchema,
} from "@suite/contracts/commands";
import { type SuiteWidget, suiteWidgetsSchema } from "@suite/contracts/widgets";
import { z } from "zod";
import { canonicalJsonValue, compareCodeUnits, findDuplicateJsonKey } from "./canonical.js";
import { PACK_CAPABILITIES, type PackCapability } from "./capabilities.js";
import type { PackContributions } from "./contributions.js";
import { isSafePackPlatform, type PackPlatform } from "./platforms.js";

export type { PackContributions } from "./contributions.js";

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

/**
 * The rings a pack may declare (S3.11).
 *
 * A ring is the pack's own stability, not a host channel (S12.8). The channel names `slop` and
 * `nightly` describe the host build, so they are deliberately not in this list: a manifest that
 * names one is refused rather than treated as some future ring. The vocabulary is closed, like a
 * capability, not open like a host kind.
 */
export const PACK_RINGS = ["stable", "preview"] as const;
export type PackRing = (typeof PACK_RINGS)[number];

/** What an absent `ring` means. It is never written into the canonical bytes. */
export const DEFAULT_PACK_RING: PackRing = "stable";

export function isPackRing(value: string): value is PackRing {
  return (PACK_RINGS as readonly string[]).includes(value);
}

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

/** A manifest or index version: semver, including a pre-release or build suffix. */
export function isSafePackVersion(value: string): boolean {
  return SEMVER.test(value);
}

/** A lower-case hex SHA-256, the only digest form a pack or an index carries. */
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

/**
 * The one order pack paths are compared in: UTF-16 code units.
 *
 * `localeCompare` puts `ä` beside `a` in one locale and after `z` in another, so a manifest signed
 * on one machine was refused as untrusted on the next. Code-unit order is the same everywhere and
 * needs no collation data, which is what makes canonical bytes canonical. The catalogue index uses
 * the same rule through `compareCodeUnits`.
 */
export const comparePackPaths = compareCodeUnits;

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
  /**
   * The noun a host shows for this document ("Canvas" / "Canvases").
   *
   * Absent means the host says "document". The field is display only; it never reaches a path
   * or a document id.
   */
  readonly name?: {
    readonly singular: string;
    readonly plural: string;
  };
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

export type { PackPlatform } from "./platforms.js";
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
  /**
   * The pack's own stability: `stable` when absent, or `preview`. Part of the
   * signed version, so it cannot be changed without a new signature (S12.10).
   */
  readonly ring?: PackRing;
  readonly entry: string;
  readonly contractVersion: number;
  /** The lowest host version that can run this pack. Absent means no floor. */
  readonly minHost?: number;
  /**
   * The pre-S3.11 spelling of `minHost`. A manifest signed before the field was
   * named carries it, so the parser still accepts it; a manifest may carry one
   * spelling or the other, never both.
   */
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

const commandSchema = packCommandContributionSchema;

const providerSchema = packProviderContributionSchema;

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
    providers: z.array(providerSchema).max(16).optional(),
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

/**
 * The noun a host shows for one of a pack's documents.
 *
 * A host's picker needs a word for "New <thing>" and "Recent <things>", and only the pack knows
 * it. A pack that declares none keeps the host's neutral "document", so every pack that shipped
 * before this field still parses.
 *
 * Surrounding whitespace is refused rather than trimmed: the manifest that is signed must be the
 * manifest that is installed, and a parse that silently rewrites a value makes those two differ.
 */
const NO_EDGE_SPACE = /^\S(?:.*\S)?$/u;
const documentNameSchema = z
  .object({
    singular: z.string().min(1).max(40).regex(NO_EDGE_SPACE, "no leading or trailing whitespace"),
    plural: z.string().min(1).max(40).regex(NO_EDGE_SPACE, "no leading or trailing whitespace"),
  })
  .strict();

/** One declared document. A host validates this shape before it looks for an entry. */
export const packDocumentSchema = z
  .object({
    id: z.string().regex(PACK_ID),
    format: z.string().min(1),
    version: z.number().int().positive(),
    name: documentNameSchema.optional(),
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

// Deliberately a string, not an enum: see `platforms.ts` and the schema's
// `$comment`. A pack may name a kind this host has never heard of.
const platformsSchema = z
  .array(z.string().refine(isSafePackPlatform, "a lower-case host kind"))
  .min(1)
  .refine(unique, "duplicate item");

const inputSchema = z
  .array(z.enum(["pointer", "touch", "keyboard"]))
  .min(1)
  .refine(unique, "duplicate item");

const localesSchema = z.array(z.string().regex(LOCALE)).refine(unique, "duplicate item");

/**
 * The ring is a closed vocabulary, so an unknown value is a refusal (S3.11).
 * The message names the two values, the rejected value and the reason a channel
 * name is not one: `JSON.stringify` is what a manifest author can search for.
 */
const ringSchema = z
  .custom<PackRing>((value) => typeof value === "string" && isPackRing(value), {
    error: (issue) =>
      `a pack ring: "stable" or "preview"; ${describeRejected(issue.input)} is not one (a channel is a host property, never a pack ring)`,
  })
  .optional();

/** A host version is a whole number from 1, under either spelling of the field. */
const hostFloorSchema = z.custom<number>(
  (value) => typeof value === "number" && Number.isInteger(value) && value >= 1,
  {
    error: (issue) =>
      `a whole host version of 1 or more; ${describeRejected(issue.input)} is not one`,
  },
);

/** The rejected value as a manifest author wrote it, for a refusal sentence. */
function describeRejected(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

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
      ring: ringSchema,
      entry: z.string().refine(isSafePackPath, "a relative path inside the pack"),
      contractVersion: z.number().int().positive(),
      minHost: hostFloorSchema.optional(),
      minimumHostVersion: hostFloorSchema.optional(),
      publisher: publisherSchema.optional(),
      capabilities: z.array(z.enum(PACK_CAPABILITIES)).default([]),
      optionalCapabilities: z.array(z.enum(PACK_CAPABILITIES)).optional(),
      documents: z.array(packDocumentSchema).max(64).optional(),
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
      // Two spellings of one fact would sign the same floor twice and leave a
      // reader to choose; a manifest carries exactly one (S3.11).
      if (value.minHost !== undefined && value.minimumHostVersion !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["minHost"],
          message: `minHost (${value.minHost}) and minimumHostVersion (${value.minimumHostVersion}) are the same host floor; carry one spelling, not both`,
        });
      }

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
        const providers = new Set<string>();
        value.contributions.providers?.forEach((provider, index) => {
          const key = `${provider.kind}\u0000${provider.entry}`;
          if (providers.has(key)) {
            context.addIssue({
              code: "custom",
              path: ["contributions", "providers", index, "entry"],
              message: `duplicate ${provider.kind} provider ${provider.entry}`,
            });
          }
          providers.add(key);
        });

        value.contributions.commands?.forEach((command, index) => {
          if (commands.has(command.id)) {
            context.addIssue({
              code: "custom",
              path: ["contributions", "commands", index, "id"],
              message: `duplicate command ${command.id}`,
            });
          }
          commands.add(command.id);

          // A provider entry is a call target, so it must be one the manifest
          // already declared. An explicit `provider` naming nothing is refused
          // here rather than called and failing later.
          if (
            command.provider !== undefined &&
            !providers.has(`commands\u0000${command.provider}`)
          ) {
            context.addIssue({
              code: "custom",
              path: ["contributions", "commands", index, "provider"],
              message: `provider ${command.provider} is not declared in contributions.providers`,
            });
          }

          if (command.icon !== undefined && !files.has(command.icon)) {
            context.addIssue({
              code: "custom",
              path: ["contributions", "commands", index, "icon"],
              message: `icon ${command.icon} is not a file the manifest lists`,
            });
          }
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
  "ring",
  "entry",
  "contractVersion",
  "minHost",
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
  /**
   * The rings this host offers. Absent means `stable` alone: a preview pack is
   * not offered until a person turns its ring on (S12.10). The set is the host's
   * preference, never something a pack can widen.
   */
  readonly rings?: readonly PackRing[];
}

export type HostFit =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "contract" | "host" | "ring"; readonly message: string };

/**
 * The ring a manifest declares, with the absent case defaulted to `stable`.
 * Reading the default here, rather than parsing it into the manifest, is what
 * keeps a manifest without a ring byte-identical to the one that was signed.
 */
export function packRing(manifest: Pick<PackManifestCore, "ring">): PackRing {
  return manifest.ring ?? DEFAULT_PACK_RING;
}

/** The host floor a manifest declares, under either spelling. */
export function packMinimumHost(
  manifest: Pick<PackManifestCore, "minHost" | "minimumHostVersion">,
): number | undefined {
  return manifest.minHost ?? manifest.minimumHostVersion;
}

export function packFitsHost(manifest: PackManifestCore, host: HostContract): HostFit {
  if (manifest.contractVersion > host.contractVersion) {
    return {
      ok: false,
      reason: "contract",
      message: `${manifest.name} needs pack contract ${manifest.contractVersion}; this host implements ${host.contractVersion}.`,
    };
  }
  const minimumHost = packMinimumHost(manifest);
  if (minimumHost !== undefined && minimumHost > host.hostVersion) {
    return {
      ok: false,
      reason: "host",
      message: `${manifest.name} needs host ${minimumHost}; this host is ${host.hostVersion}.`,
    };
  }
  const ring = packRing(manifest);
  const offered = host.rings ?? [DEFAULT_PACK_RING];
  if (!offered.includes(ring)) {
    return {
      ok: false,
      reason: "ring",
      message: `${manifest.name} is a ${ring} ring pack; this host offers ${offered.join(" and ") || "no ring"}.`,
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
