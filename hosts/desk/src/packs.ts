import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type SuiteWidget, suiteWidgetsSchema } from "@suite/contracts";
import { resolveProtocolAsset } from "@suite/desktop";
import {
  DEFAULT_PACK_RING,
  type HostContract,
  isPackRing,
  isSafePackId,
  isSafePackPath,
  PACK_CONTRACT_VERSION,
  PACK_FORMAT,
  type PackDocument,
  type PackManifestCore,
  type PackRing,
  packAllows,
  packDocumentSchema,
  packFitsHost,
  packMinimumHost,
  packRing,
} from "@suite/pack/manifest";
import { DESK_HOST, type HostDeclaration, platformFit } from "@suite/pack/platforms";
import { z } from "zod";
import { DEFAULT_CONTAINER_ID } from "./container.js";
import { FIRST_PARTY_PUBLISHER_ID, packStorageKey } from "./packIdentity.js";
import { PACK_CAPABILITIES, PACK_SCHEME, type PackCapability, type PackSummary } from "./shared.js";

export { isSafePackId, PACK_FORMAT, packAllows } from "@suite/pack/manifest";

/**
 * A pack on disk.
 *
 * The host knows a manifest, an entry and a set of capabilities. It does not
 * import the pack, run its code, or guess what its documents mean. The manifest
 * is data; everything else belongs to the renderer that arrives later.
 *
 * Signed packs are the load path: `installedPacks.ts` verifies an archive against
 * the pinned key and installs it under `<dataRoot>/packs/<id>/<version>`. This
 * module's directory discovery is the explicit development path only; a packaged
 * build never reads an unsigned directory.
 */
/** What this host implements. A pack built for a newer contract is refused by name. */
export const HOST_CONTRACT_VERSION = PACK_CONTRACT_VERSION;
export const HOST_VERSION = 1;

/**
 * The rings this host offers by default (S12.10).
 *
 * `stable` alone. `preview` is added only by the person's explicit choice, which
 * is a host setting: a pack may declare its ring, but never widen the set.
 */
export const HOST_RINGS: readonly PackRing[] = [DEFAULT_PACK_RING];

/** The rings a host setting names, falling back to the default when it names none. */
export function hostRingsFor(value: string | undefined): readonly PackRing[] {
  const requested = (value ?? "")
    .split(/[\s,]+/u)
    .map((ring) => ring.trim())
    .filter((ring) => ring.length > 0);
  const rings = requested.filter(isPackRing);
  // `stable` is always the base; a setting can only add `preview` to it.
  return rings.length === 0 ? HOST_RINGS : [...new Set([DEFAULT_PACK_RING, ...rings])];
}

/**
 * The capabilities this host actually serves.
 *
 * The declaration lives in `@suite/pack/platforms` beside the Go host's, so the
 * catalogue compares one shared fact rather than a copy. The desk host extends
 * that base with `relay`: the supervisor spawns the relay child and the pack
 * broker forwards opaque frames, so a pack that declares it is no longer refused
 * at discovery. The shared declaration catches up when the catalogue rows need
 * to name the relay too; until then this is the host's own addition.
 */
export const HOST_DECLARATION: HostDeclaration = {
  ...DESK_HOST,
  capabilities: [...DESK_HOST.capabilities, "relay"],
};

export const HOST_CAPABILITIES = HOST_DECLARATION.capabilities;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * A host floor is a whole host version from 1, under either spelling (S3.11).
 * The older `minimumHostVersion` is the same fact a manifest signed before the
 * field existed carries.
 */
const hostFloorSchema = z
  .number()
  .int("a whole host version of 1 or more")
  .min(1, "a whole host version of 1 or more");

const ringSchema = z
  .custom<PackRing>((value) => typeof value === "string" && isPackRing(value), {
    error: (issue) => {
      const rejected = JSON.stringify(issue.input) ?? String(issue.input);
      return `a pack ring: "stable" or "preview"; ${rejected} is not one (a channel is a host property, never a pack ring)`;
    },
  })
  .optional();

const manifestSchema = z
  .object({
    format: z.literal(PACK_FORMAT),
    id: z.string().refine(isSafePackId, "lower kebab-case, at most 32 characters"),
    name: z.string().min(1).max(64),
    version: z.string().regex(SEMVER),
    ring: ringSchema,
    entry: z.string().refine(isSafePackPath, "a relative path inside the pack"),
    description: z.string().max(200).optional(),
    contractVersion: z.number().int().positive(),
    minHost: hostFloorSchema.optional(),
    minimumHostVersion: hostFloorSchema.optional(),
    publisher: z
      .object({ key: z.string().min(32), id: z.string().min(1).max(64).optional() })
      .strict()
      .optional(),
    capabilities: z.array(z.enum(PACK_CAPABILITIES)).default([]),
    optionalCapabilities: z.array(z.enum(PACK_CAPABILITIES)).optional(),
    documents: z.array(packDocumentSchema).max(64).optional(),
    // Opaque host kinds (S3.5): a development pack may name a kind this host has
    // never heard of, and the fit check below decides what that means.
    platforms: z.array(z.string()).min(1).optional(),
    widgets: suiteWidgetsSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    // One floor has one spelling in a manifest, or a reader has to choose (S3.11).
    if (value.minHost !== undefined && value.minimumHostVersion !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["minHost"],
        message: `minHost (${value.minHost}) and minimumHostVersion (${value.minimumHostVersion}) are the same host floor; carry one spelling, not both`,
      });
    }
  });

/** A pack plus where its files live. `root` never crosses the IPC bridge. */
export interface PackInfo extends PackSummary {
  readonly root: string;
  /** The pack's effective ring and host floor, for the catalogue and refusal copy. */
  readonly ring?: PackRing;
  readonly minHost?: number;
  /** Widget descriptors the manifest declares. The host draws them; it runs no code. */
  readonly widgets?: readonly SuiteWidget[];
  /** Documents the manifest declares, with their migrations and projection. */
  readonly documents?: readonly PackDocument[];
}

export interface PackRequest {
  readonly file: string;
  readonly pack: PackInfo;
}

/**
 * Where a development pack directory lives.
 *
 * Development packs always sit beside the app's checkout. `resourcesPath` is
 * deliberately not a source: a packaged build must not load an unsigned
 * directory, and only `SUITE_DESK_DEV_PACKS=1` in a checkout opts into these.
 */
export function packsRootFor(appPath: string): string {
  return join(appPath, "packs");
}

export function packOrigin(id: string, containerId = DEFAULT_CONTAINER_ID): string {
  return `${PACK_SCHEME}://${containerId}.${id}`;
}

/** The URL a pack file is loaded from. Segments are encoded; the resolver re-checks them. */
export function packUrl(id: string, entry: string, containerId = DEFAULT_CONTAINER_ID): string {
  return `${packOrigin(id, containerId)}/${entry.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * What a tab loads now: the installed pack, and its current entry.
 *
 * A tab records the entry that existed when it was opened, and the space
 * document keeps that value for display. An updated pack may rename its entry,
 * so loading the recorded path after a restart reaches a file that is no longer
 * there. The installed pack's `entry` is the only path that exists now.
 */
export function tabViewTarget(
  packs: readonly PackInfo[],
  tab: { readonly packId: string; readonly entry: string },
  containerId = DEFAULT_CONTAINER_ID,
): { readonly pack: PackInfo; readonly url: string } | null {
  const pack = packs.find((candidate) => candidate.id === tab.packId);
  if (pack === undefined) return null;
  return { pack, url: packUrl(pack.id, pack.entry, containerId) };
}

/**
 * The URL a pack may hand to the OS browser, or `null`.
 *
 * The browser is network egress outside the pack's session and its CSP, so the
 * same `network` capability that governs those governs this. A pack without it
 * gets no browser open, even for a link it cannot otherwise reach.
 */
export function externalLinkFor(
  pack: Pick<PackSummary, "capabilities">,
  url: string,
): string | null {
  if (!packAllows(pack, "network")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function packPartition(
  id: string,
  containerId = DEFAULT_CONTAINER_ID,
  publisherId = FIRST_PARTY_PUBLISHER_ID,
): string {
  return `persist:${containerId}:${packStorageKey(publisherId, id)}`;
}

function readPack(directory: string, host: HostContract): PackInfo | null {
  const manifestPath = join(directory, "manifest.json");
  if (!existsSync(manifestPath)) return null;

  try {
    const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[desk] ${manifestPath} is not a pack manifest`, parsed.error.issues);
      return null;
    }

    // The development schema is the unsigned subset this loader accepts; the
    // fit rules come from the one shared contract, not a second copy.
    const manifest = parsed.data as unknown as PackManifestCore;
    const fit = packFitsHost(manifest, host);
    if (!fit.ok) {
      // S3.12 names the pack, the requirement and the host's own value. A ring
      // refusal names the ring and the host's offered set, which is the setting
      // that would have to change.
      if (fit.reason === "ring") {
        const ring = packRing(manifest);
        const offered = host.rings ?? HOST_RINGS;
        console.warn(
          `[desk] ${manifest.id} is a ${ring} ring pack; this host offers ${offered.join(", ") || "no ring"}`,
        );
      } else {
        console.warn(`[desk] ${manifest.id}: ${fit.message}`);
      }
      return null;
    }

    const unsupported = parsed.data.capabilities.filter(
      (capability) => !(HOST_CAPABILITIES as readonly string[]).includes(capability),
    );
    if (unsupported.length > 0) {
      console.warn(
        `[desk] ${parsed.data.id} asks for unimplemented ${unsupported.join(", ")}; refusing it`,
      );
      return null;
    }

    const platform = platformFit(
      {
        ...(parsed.data.platforms === undefined ? {} : { platforms: parsed.data.platforms }),
        capabilities: parsed.data.capabilities,
      },
      HOST_DECLARATION,
    );
    if (platform.state === "unavailable") {
      console.warn(`[desk] ${parsed.data.id} is ${platform.reason}; refusing it`);
      return null;
    }

    const entryPath = join(directory, parsed.data.entry);
    if (!existsSync(entryPath) || !statSync(entryPath).isFile()) {
      console.warn(`[desk] ${parsed.data.id} names an entry that does not exist: ${entryPath}`);
      return null;
    }

    // The summary is what every later `packAllows` call reads, so it carries the
    // optional capabilities too. The load refusal above still checks only the
    // required list: a missing optional capability degrades (S4.1), and the host's
    // absent service is what a pack observes.
    const declared = [
      ...new Set([...parsed.data.capabilities, ...(parsed.data.optionalCapabilities ?? [])]),
    ] as readonly PackCapability[];

    return {
      id: parsed.data.id,
      name: parsed.data.name,
      version: parsed.data.version,
      description: parsed.data.description ?? null,
      entry: parsed.data.entry,
      capabilities: declared,
      ring: packRing(manifest),
      ...(packMinimumHost(manifest) === undefined
        ? {}
        : { minHost: packMinimumHost(manifest) as number }),
      documents: (parsed.data.documents ?? []) as readonly PackDocument[],
      widgets: parsed.data.widgets ?? [],
      publisher: null,
      root: directory,
      source: "development",
    };
  } catch (error) {
    console.warn(`[desk] could not read ${manifestPath}`, error);
    return null;
  }
}

export interface PackDiscoveryOptions {
  /** The rings this host offers; defaults to `HOST_RINGS` (`stable` alone). */
  readonly rings?: readonly PackRing[];
  readonly hostVersion?: number;
  readonly contractVersion?: number;
}

export function discoverPacks(
  root: string,
  options: PackDiscoveryOptions | readonly PackRing[] = {},
): readonly PackInfo[] {
  if (!existsSync(root)) return [];

  const resolved: PackDiscoveryOptions = Array.isArray(options)
    ? { rings: options as readonly PackRing[] }
    : (options as PackDiscoveryOptions);
  const host: HostContract = {
    contractVersion: resolved.contractVersion ?? HOST_CONTRACT_VERSION,
    hostVersion: resolved.hostVersion ?? HOST_VERSION,
    rings: resolved.rings ?? HOST_RINGS,
  };
  const found: PackInfo[] = [];
  const seen = new Set<string>();
  const entries = readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pack = readPack(join(root, entry.name), host);
    if (pack === null) continue;
    if (seen.has(pack.id)) {
      console.warn(`[desk] duplicate pack id ${pack.id}; ignoring ${pack.root}`);
      continue;
    }
    seen.add(pack.id);
    found.push(pack);
  }
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Resolve a `suite-pack://<container>.<id>/...` request against that pack's own directory.
 *
 * The shared resolver is the authority on traversal: it reads the raw URL so a
 * `..` is refused before `new URL` can normalise it away. This function only
 * finds the pack by host and delegates.
 */
export function resolvePackRequest(
  requestUrl: string,
  packs: readonly PackInfo[],
  containerId = DEFAULT_CONTAINER_ID,
): PackRequest | null {
  let host: string;
  try {
    host = new URL(requestUrl).host.toLowerCase();
  } catch {
    return null;
  }

  const origin = `${PACK_SCHEME}://${host}`;
  const pack = packs.find((candidate) => packOrigin(candidate.id, containerId) === origin);
  if (pack === undefined) return null;

  const resolved = resolveProtocolAsset(requestUrl, pack.root, {
    scheme: PACK_SCHEME,
    hosts: [host],
  });
  return resolved.ok ? { file: resolved.file, pack } : null;
}
