import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type SuiteWidget, suiteWidgetsSchema } from "@suite/contracts";
import { resolveProtocolAsset } from "@suite/desktop";
import {
  isSafePackId,
  isSafePackPath,
  PACK_CONTRACT_VERSION,
  PACK_FORMAT,
  type PackDocument,
  packAllows,
  packDocumentSchema,
} from "@suite/pack/manifest";
import { z } from "zod";
import { DEFAULT_CONTAINER_ID } from "./container.js";
import { FIRST_PARTY_PUBLISHER_ID, packStorageKey } from "./packIdentity.js";
import { PACK_CAPABILITIES, PACK_SCHEME, type PackCapability, type PackSummary } from "./shared.js";

export { isSafePackId, PACK_FORMAT, packAllows } from "@suite/pack/manifest";

/**
 * A pack on disk.
 *
 * The shell knows a manifest, an entry and a set of capabilities. It does not
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
 * The capabilities this spike actually serves.
 *
 * The shared vocabulary is wider; a pack that declares a service this host does
 * not implement is refused rather than loaded into a broken bridge. Add a name
 * here in the same change that adds the service.
 */
export const HOST_CAPABILITIES = ["documents", "files", "network"] as const;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

const manifestSchema = z
  .object({
    format: z.literal(PACK_FORMAT),
    id: z.string().refine(isSafePackId, "lower kebab-case, at most 32 characters"),
    name: z.string().min(1).max(64),
    version: z.string().regex(SEMVER),
    entry: z.string().refine(isSafePackPath, "a relative path inside the pack"),
    description: z.string().max(200).optional(),
    contractVersion: z.number().int().positive(),
    minimumHostVersion: z.number().int().positive().optional(),
    publisher: z
      .object({ key: z.string().min(32), id: z.string().min(1).max(64).optional() })
      .strict()
      .optional(),
    capabilities: z.array(z.enum(PACK_CAPABILITIES)).default([]),
    documents: z.array(packDocumentSchema).max(64).optional(),
    widgets: suiteWidgetsSchema.optional(),
  })
  .strict();

/** A pack plus where its files live. `root` never crosses the IPC bridge. */
export interface PackInfo extends PackSummary {
  readonly root: string;
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
 * directory, and only `SUITE_SHELL_DEV_PACKS=1` in a checkout opts into these.
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

function readPack(directory: string): PackInfo | null {
  const manifestPath = join(directory, "manifest.json");
  if (!existsSync(manifestPath)) return null;

  try {
    const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[shell] ${manifestPath} is not a pack manifest`, parsed.error.issues);
      return null;
    }

    if (parsed.data.contractVersion > HOST_CONTRACT_VERSION) {
      console.warn(
        `[shell] ${parsed.data.id} needs contract ${parsed.data.contractVersion}; this host implements ${HOST_CONTRACT_VERSION}`,
      );
      return null;
    }
    if (
      parsed.data.minimumHostVersion !== undefined &&
      parsed.data.minimumHostVersion > HOST_VERSION
    ) {
      console.warn(
        `[shell] ${parsed.data.id} needs host ${parsed.data.minimumHostVersion}; this host is ${HOST_VERSION}`,
      );
      return null;
    }

    const unsupported = parsed.data.capabilities.filter(
      (capability) => !(HOST_CAPABILITIES as readonly string[]).includes(capability),
    );
    if (unsupported.length > 0) {
      console.warn(
        `[shell] ${parsed.data.id} asks for unimplemented ${unsupported.join(", ")}; refusing it`,
      );
      return null;
    }

    const entryPath = join(directory, parsed.data.entry);
    if (!existsSync(entryPath) || !statSync(entryPath).isFile()) {
      console.warn(`[shell] ${parsed.data.id} names an entry that does not exist: ${entryPath}`);
      return null;
    }

    return {
      id: parsed.data.id,
      name: parsed.data.name,
      version: parsed.data.version,
      description: parsed.data.description ?? null,
      entry: parsed.data.entry,
      capabilities: parsed.data.capabilities as readonly PackCapability[],
      documents: (parsed.data.documents ?? []) as readonly PackDocument[],
      widgets: parsed.data.widgets ?? [],
      publisher: null,
      root: directory,
      source: "development",
    };
  } catch (error) {
    console.warn(`[shell] could not read ${manifestPath}`, error);
    return null;
  }
}

export function discoverPacks(root: string): readonly PackInfo[] {
  if (!existsSync(root)) return [];

  const found: PackInfo[] = [];
  const seen = new Set<string>();
  const entries = readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pack = readPack(join(root, entry.name));
    if (pack === null) continue;
    if (seen.has(pack.id)) {
      console.warn(`[shell] duplicate pack id ${pack.id}; ignoring ${pack.root}`);
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
