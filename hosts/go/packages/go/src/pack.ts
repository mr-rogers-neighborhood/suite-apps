/**
 * A domain pack: what arrives when a person installs a domain.
 *
 * The shape is deliberately small, and every field earns its place:
 *
 * - `id` and `version` because a pack is a thing that can be installed twice and upgraded.
 * - `entry` because the host has to know which file to import, and guessing is not a policy.
 * - `contractVersion` and `minimumHostVersion` because a pack built for a host it does not
 *   have must be refused with a reason rather than crashing on a missing method.
 * - `independent` because a pack that can open on its own, with no hub in the path, behaves
 *   differently when it is launched: there is no shell state to inherit.
 * - `files` with a hash each, because the signature covers the manifest and the manifest
 *   covers the bytes.
 *
 * Verification is two steps and both are required. The signature proves the manifest came
 * from whoever holds the key; the per-file hashes prove the files on disk are the ones that
 * manifest describes. A pack that passes only one is not safe to run.
 *
 * Everything here is pure and uses `globalThis.crypto`, which is the WebCrypto API in a
 * WebView and in Node 22+. That is why the same code verifies a pack in a test and on a phone.
 */
import { hashes, verify as nobleVerify } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { type SuiteWidget, suiteWidgetsSchema } from "@suite/contracts/widgets";
import { isSuiteGoModuleId } from "./module.js";

/**
 * Ed25519 hashing, supplied explicitly rather than taken from WebCrypto.
 *
 * Verification used to call `crypto.subtle` and read as a clean design until it ran on a second
 * device: a WebView without Ed25519 throws `Unrecognized name`, the old code caught that and
 * answered `false`, and the app told the person their pack's "signature does not match" — a lie
 * that blames the pack for the host's shortcoming.
 *
 * A pure implementation has no such gap. It is also the same family the suite's sync protocol
 * already depends on, so this adds no new trust surface.
 */
hashes.sha512 = sha512;

export const PACK_FORMAT = "suite.pack";

/**
 * The rings a pack may declare (S3.11).
 *
 * A ring is the pack's own stability, not a host channel. The channel names
 * `slop` and `nightly` describe the host build, so they are deliberately not in
 * this list; the vocabulary is closed like a capability.
 */
export const PACK_RINGS = ["stable", "preview"] as const;
export type PackRing = (typeof PACK_RINGS)[number];
export const DEFAULT_PACK_RING: PackRing = "stable";

export function isPackRing(value: unknown): value is PackRing {
  return typeof value === "string" && (PACK_RINGS as readonly string[]).includes(value);
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
/** An exact origin: no wildcard, path, query or fragment (S4.4). */
export const NETWORK_ORIGIN = /^(https|wss):\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/u;
// Host kinds are an open vocabulary: this only rejects malformed values, never
// an unknown one. See `manifest.schema.json` in docs/spec.
const PLATFORM_KIND = /^[a-z][a-z0-9-]{0,31}$/u;

/**
 * Which document a pack renders in.
 *
 * `isolated` is the only mode: its own document, its own CSS scope, its own React (ADR-0003).
 * `shared` would have rendered inside the shell's document against the shell's React, and it is
 * refused rather than honoured — the import-map route it depended on is not supported by the
 * toolchain, and a mode that half-works is worse than one that says so.
 *
 * What `isolated` does **not** buy is a separate process, or a security boundary (ADR-0002): an
 * iframe is a new document and a new JS realm in the same renderer, same origin. The JS heap is
 * separate — measured — so a runaway allocation exhausts its own isolate. The shell's DOM is not
 * protected; capabilities are what protect the data.
 */
export type PackIsolation = "shared" | "isolated";

/**
 * What a pack may ask the host for.
 *
 * Coarse on purpose — four words a person can reason about without reading code. Deny by default:
 * a manifest with no capabilities renders and does nothing else, which is the correct starting
 * point for something that arrived over the network.
 *
 * `network` is the one capability a pack can be held to today without an origin boundary. The host
 * cannot stop a same-origin pack from calling `fetch`, but a pack that does not declare `network`
 * must ship a Content-Security-Policy that forbids egress, and the install refuses it otherwise
 * (`checkNetworkPolicy`). The browser enforces the policy; the host enforces that it is present.
 *
 * The other four are enforced per request by the frame bridge, which is a capability boundary
 * rather than a sandbox: a pack can still reach the shell's DOM (ADR-0002).
 */
export const PACK_CAPABILITIES = [
  "documents",
  "storage",
  "files",
  "recents",
  "notifications",
  "network",
  "identity.pack",
] as const;

export type PackCapability = (typeof PACK_CAPABILITIES)[number];

export function isPackCapability(value: unknown): value is PackCapability {
  return typeof value === "string" && (PACK_CAPABILITIES as readonly string[]).includes(value);
}

/** One file inside a pack. `path` is relative to the pack root and slash-separated. */
export interface PackFile {
  readonly path: string;
  /** Lower-case hex. */
  readonly sha256: string;
  readonly bytes: number;
}

/** The part a signature covers. No signature field, and no host-specific fields. */
/** Who published a pack. The id survives a key rotation; the key signs the manifest. */
export interface PackPublisher {
  /** Standard base64 Ed25519 public key. Required whenever `publisher` is present. */
  readonly key: string;
  /** The stable publisher id. Absent means the key's digest names it. */
  readonly id?: string;
}

/**
 * A pack's exact-origin network allowlist (S4.4).
 *
 * Every entry is an `https://` or `wss://` origin: no wildcard, path or fragment.
 * The host derives `connect-src` from this list; a pack that declares `network`
 * without one is refused rather than allowed to reach anything.
 */
export interface PackNetwork {
  readonly allow: readonly string[];
}

export interface PackManifestCore {
  readonly format: typeof PACK_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Who published the pack. Absent means the first-party `suite` publisher. */
  readonly publisher?: PackPublisher;
  /** The module file to import, relative to the pack root. */
  readonly entry: string;
  /** The pack's own stability; absent means `stable` (S3.11). */
  readonly ring?: PackRing;
  readonly contractVersion: number;
  /** The lowest host version that can run this pack. Absent means no floor. */
  readonly minHost?: number;
  /** The pre-S3.11 spelling of `minHost`; a manifest carries one spelling, never both. */
  readonly minimumHostVersion?: number;
  /** True when the pack opens on its own, without the hub. */
  readonly independent: boolean;
  /** Which document the pack renders in. Absent means `shared`. */
  readonly isolation: PackIsolation;
  /** What it may ask the host for. Empty means it may render and nothing else. */
  readonly capabilities: readonly PackCapability[];
  /** The exact origins `network` may reach. Required when `network` is declared (S4.4). */
  readonly network?: PackNetwork;
  /**
   * Host kinds this pack is meant for. Opaque values: an unknown kind parses and
   * simply matches no host. Absent means unknown, never universal.
   */
  readonly platforms?: readonly string[];
  readonly files: readonly PackFile[];
  /**
   * The host surfaces the pack offers, under the same contract a desktop app declares.
   *
   * Optional in the core because it is additive: a manifest written before widgets
   * carries no key, and the canonical bytes are unchanged when it is empty, so an
   * existing signature still verifies.
   */
  readonly widgets?: readonly SuiteWidget[];
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

/**
 * A pack path must stay inside the pack.
 *
 * Rejecting `.` and `..` segments, absolute paths, backslashes and control characters is
 * what stops a manifest from naming a file outside the directory it is installed into.
 * The same three checks the suite's deep-link parser makes, for the same reason: the input
 * is attacker-controlled, and the failure is silent without them.
 */
export function isSafePackPath(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/")) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are what this rejects.
  if (/[\\\u0000-\u001f\u007f]/u.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** The rejected value as its author wrote it, for a refusal sentence. */
function describeRejected(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

export function parsePackManifest(value: unknown): PackParse {
  const issues: PackIssue[] = [];

  if (typeof value !== "object" || value === null) {
    return { ok: false, issues: [{ path: "", message: "a manifest is an object" }] };
  }

  const raw = value as Record<string, unknown>;
  const fail = (path: string, message: string) => issues.push({ path, message });

  if (raw.format !== PACK_FORMAT) fail("format", `expected "${PACK_FORMAT}"`);

  const id = typeof raw.id === "string" ? raw.id : "";
  if (!isSuiteGoModuleId(id)) fail("id", "lower kebab-case, at most 32 characters");

  const name = typeof raw.name === "string" ? raw.name : "";
  if (name.length === 0 || name.length > 64) fail("name", "one to 64 characters");

  const version = typeof raw.version === "string" ? raw.version : "";
  if (!SEMVER.test(version)) fail("version", "semver");

  if (raw.ring !== undefined && !isPackRing(raw.ring)) {
    fail(
      "ring",
      `a pack ring: "stable" or "preview"; ${describeRejected(raw.ring)} is not one (a channel is a host property, never a pack ring)`,
    );
  }

  const entry = typeof raw.entry === "string" ? raw.entry : "";
  if (!isSafePackPath(entry)) fail("entry", "a relative path inside the pack");

  const contractVersion =
    typeof raw.contractVersion === "number" && Number.isInteger(raw.contractVersion)
      ? raw.contractVersion
      : Number.NaN;
  if (Number.isNaN(contractVersion)) fail("contractVersion", "an integer");

  // `minHost` and the older `minimumHostVersion` are one fact in two spellings
  // (S3.11). Either is a whole host version from 1; both together is refused.
  for (const spelling of ["minHost", "minimumHostVersion"] as const) {
    const floor = raw[spelling];
    if (
      floor !== undefined &&
      (typeof floor !== "number" || !Number.isInteger(floor) || floor < 1)
    ) {
      fail(spelling, `a whole host version of 1 or more; ${describeRejected(floor)} is not one`);
    }
  }
  if (raw.minHost !== undefined && raw.minimumHostVersion !== undefined) {
    fail(
      "minHost",
      `minHost (${String(raw.minHost)}) and minimumHostVersion (${String(raw.minimumHostVersion)}) are the same host floor; carry one spelling, not both`,
    );
  }

  if (typeof raw.independent !== "boolean") fail("independent", "true or false");

  // Defaults to `isolated`, and an explicit `shared` is refused with a reason (ADR-0003).
  const isolation: PackIsolation = raw.isolation === "shared" ? "shared" : "isolated";
  if (raw.isolation !== undefined && raw.isolation !== "shared" && raw.isolation !== "isolated") {
    fail("isolation", 'either "shared" or "isolated"');
  }
  if (raw.isolation === "shared") {
    fail(
      "isolation",
      'the "shared" hosting mode was withdrawn: rebuild the pack for its own document, or remove the field and it defaults to "isolated"',
    );
  }

  const files: PackFile[] = [];
  if (!Array.isArray(raw.files)) {
    fail("files", "an array");
  } else {
    const seen = new Set<string>();
    raw.files.forEach((candidate, index) => {
      const path = `files.${index}`;
      if (typeof candidate !== "object" || candidate === null) {
        fail(path, "an object");
        return;
      }
      const file = candidate as Record<string, unknown>;
      const filePath = typeof file.path === "string" ? file.path : "";
      if (!isSafePackPath(filePath)) fail(`${path}.path`, "a relative path inside the pack");
      else if (seen.has(filePath)) fail(`${path}.path`, `duplicate path ${filePath}`);
      else seen.add(filePath);

      const sha256 = typeof file.sha256 === "string" ? file.sha256 : "";
      if (!SHA256_HEX.test(sha256)) fail(`${path}.sha256`, "64 lower-case hex characters");

      if (typeof file.bytes !== "number" || !Number.isInteger(file.bytes) || file.bytes < 0) {
        fail(`${path}.bytes`, "a non-negative integer");
      }

      files.push({
        path: filePath,
        sha256,
        bytes: typeof file.bytes === "number" ? file.bytes : 0,
      });
    });

    if (files.length === 0) fail("files", "at least one file");
    if (!files.some((file) => file.path === entry)) {
      fail("entry", "must name a file the manifest lists");
    }
  }

  const signature = typeof raw.signature === "string" ? raw.signature : "";
  if (signature.length === 0) fail("signature", "base64 Ed25519 signature");

  const capabilities: PackCapability[] = [];
  if (raw.capabilities !== undefined) {
    if (!Array.isArray(raw.capabilities)) {
      fail("capabilities", "an array of capability names");
    } else {
      const seen = new Set<string>();
      raw.capabilities.forEach((candidate, index) => {
        if (!isPackCapability(candidate)) {
          fail(`capabilities.${index}`, `one of ${PACK_CAPABILITIES.join(", ")}`);
          return;
        }
        if (seen.has(candidate)) {
          fail(`capabilities.${index}`, `duplicate ${candidate}`);
          return;
        }
        seen.add(candidate);
        capabilities.push(candidate);
      });
    }
  }

  let publisher: PackPublisher | undefined;
  if (raw.publisher !== undefined) {
    if (typeof raw.publisher !== "object" || raw.publisher === null) {
      fail("publisher", "an object with an optional id and key");
    } else {
      const value = raw.publisher as Record<string, unknown>;
      const id = value.id;
      const key = value.key;
      if (id !== undefined && (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id))) {
        fail("publisher.id", "a lower-case publisher id");
      }
      if (typeof key !== "string" || key.length === 0) {
        fail("publisher.key", "a base64 Ed25519 public key");
      }
      publisher = {
        ...(typeof id === "string" ? { id } : {}),
        key: typeof key === "string" ? key : "",
      };
    }
  }

  // S4.4: `network` is an exact-origin allowlist. A declared capability with no
  // list would be permission to reach anything, so an empty list is refused here
  // and the policy check refuses the pair as well.
  let network: PackNetwork | undefined;
  if (raw.network !== undefined) {
    if (typeof raw.network !== "object" || raw.network === null) {
      fail("network", "an object with a non-empty allow list");
    } else {
      const value = raw.network as Record<string, unknown>;
      const allow: string[] = [];
      if (!Array.isArray(value.allow)) {
        fail("network.allow", "a non-empty array of origins");
      } else {
        const seen = new Set<string>();
        value.allow.forEach((candidate, index) => {
          if (typeof candidate !== "string" || !NETWORK_ORIGIN.test(candidate)) {
            fail(
              `network.allow.${index}`,
              "an https:// or wss:// origin with no wildcard, path or fragment",
            );
            return;
          }
          if (seen.has(candidate)) {
            fail(`network.allow.${index}`, `duplicate ${candidate}`);
            return;
          }
          seen.add(candidate);
          allow.push(candidate);
        });
        if (allow.length === 0) fail("network.allow", "at least one origin");
      }
      network = { allow };
    }
  }

  // Host kinds are opaque (S3.5). A kind this build has never heard of is still a
  // valid declaration; only the shape is checked, because rejecting it here would
  // make the pack uninstallable on every host.
  const platforms: string[] = [];
  if (raw.platforms !== undefined) {
    if (!Array.isArray(raw.platforms)) {
      fail("platforms", "an array of host kinds");
    } else {
      const seen = new Set<string>();
      raw.platforms.forEach((candidate, index) => {
        if (typeof candidate !== "string" || !PLATFORM_KIND.test(candidate)) {
          fail(`platforms.${index}`, "a lower-case host kind");
          return;
        }
        if (seen.has(candidate)) {
          fail(`platforms.${index}`, `duplicate ${candidate}`);
          return;
        }
        seen.add(candidate);
        platforms.push(candidate);
      });
      if (platforms.length === 0) fail("platforms", "at least one host kind");
    }
  }

  // The widgets a pack declares are the same descriptors a desktop app puts in
  // `suite.app.json`, validated by the same contract, so a host renders both without a
  // second shape. Empty is the ordinary case and is left out of the canonical bytes.
  const widgets: SuiteWidget[] = [];
  if (raw.widgets !== undefined) {
    const parsed = suiteWidgetsSchema.safeParse(raw.widgets);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        fail(`widgets.${issue.path.map(String).join(".")}`, issue.message);
      }
    } else {
      widgets.push(...parsed.data);
    }
  }

  // The entry has to match the mode: an isolated pack owns a page, a shared pack is a module
  // imported into one. Getting this wrong produces a blank frame or an import of an HTML
  // file, neither of which names the mistake.
  if (isolation === "isolated" && !entry.endsWith(".html")) {
    fail("entry", "an isolated pack's entry is an HTML document");
  }
  if (isolation === "shared" && entry.endsWith(".html")) {
    fail("entry", 'a shared pack\'s entry is a module; declare isolation "isolated" for a page');
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      format: PACK_FORMAT,
      id,
      name,
      version,
      ...(publisher === undefined ? {} : { publisher }),
      ...(raw.ring === undefined ? {} : { ring: raw.ring as PackRing }),
      entry,
      contractVersion,
      ...(raw.minHost === undefined ? {} : { minHost: raw.minHost as number }),
      ...(raw.minimumHostVersion === undefined
        ? {}
        : { minimumHostVersion: raw.minimumHostVersion as number }),
      independent: raw.independent as boolean,
      isolation,
      capabilities,
      ...(network === undefined ? {} : { network }),
      ...(platforms.length > 0 ? { platforms } : {}),
      files,
      ...(widgets.length > 0 ? { widgets } : {}),
      signature,
    },
  };
}

/**
 * The exact bytes a signature covers.
 *
 * Built field by field in a fixed order rather than by `JSON.stringify(manifest)`, because
 * JSON key order follows insertion and two encoders can differ. A signature over "whatever
 * JSON.stringify produced" verifies only on the machine that produced it.
 */
export function canonicalManifestBytes(manifest: PackManifestCore): Uint8Array {
  const canonical = {
    format: manifest.format,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    // Omitted when absent, so a manifest signed before publisher and network
    // were carried keeps its canonical bytes and its signature.
    ...(manifest.publisher === undefined ? {} : { publisher: manifest.publisher }),
    // New optional fields are omitted when absent, so a manifest signed before
    // S3.11 keeps the bytes and the signature it already had. `minimumHostVersion`
    // stays as it was written by this host's earlier canonical form.
    ...(manifest.ring === undefined ? {} : { ring: manifest.ring }),
    entry: manifest.entry,
    contractVersion: manifest.contractVersion,
    ...(manifest.minHost === undefined ? {} : { minHost: manifest.minHost }),
    minimumHostVersion: manifest.minimumHostVersion ?? null,
    independent: manifest.independent,
    isolation: manifest.isolation,
    capabilities: manifest.capabilities,
    ...(manifest.network === undefined ? {} : { network: manifest.network }),
    // Omitted when absent, like every optional field: a manifest written before
    // host kinds were declared keeps the same canonical bytes and signature.
    ...(manifest.platforms !== undefined && manifest.platforms.length > 0
      ? { platforms: manifest.platforms }
      : {}),
    files: manifest.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
    // Added last and omitted when empty, so the bytes of a manifest written before
    // widgets are byte-identical and its signature still verifies.
    ...(manifest.widgets !== undefined && manifest.widgets.length > 0
      ? { widgets: manifest.widgets }
      : {}),
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function sha256Hex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", bytes as BufferSource)
    .then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

/**
 * Does this manifest carry a signature from the key we pinned?
 *
 * `publicKey` is raw 32-byte Ed25519, base64. An import or a signature that cannot be
 * parsed is `false`, never an exception: a malformed pack is a rejected pack, not a crash.
 */
export async function verifyPackSignature(
  manifest: PackManifest,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    return nobleVerify(
      base64ToBytes(manifest.signature),
      canonicalManifestBytes(manifest),
      base64ToBytes(publicKeyBase64),
    );
  } catch {
    return false;
  }
}

/**
 * The one version order a pack has.
 *
 * Semver precedence, so `1.10.0` is newer than `1.9.0`: sorting version directory names as
 * strings would make a phone keep the older one active. The desktop host and Go must choose the
 * same active version from the same layout, or one install on two hosts is two products.
 *
 * A prerelease is lower than its release (`2.0.0-rc.1` < `2.0.0`), and identifiers compare
 * numerically when both are digits and by code unit otherwise. A malformed version throws rather
 * than sorting somewhere arbitrary: every caller here parsed the version first.
 */
export function comparePackVersions(left: string, right: string): number {
  const a = parsePackVersion(left);
  const b = parsePackVersion(right);
  if (a === null || b === null) {
    throw new TypeError(`Not a pack version: ${a === null ? left : right}`);
  }

  for (let index = 0; index < 3; index += 1) {
    const leftPart = a.core[index];
    const rightPart = b.core[index];
    if (leftPart === undefined || rightPart === undefined) continue;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
}

interface ParsedPackVersion {
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[];
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const NUMERIC = /^\d+$/u;

function parsePackVersion(value: string): ParsedPackVersion | null {
  const match = VERSION.exec(value);
  if (match === null) return null;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return {
    core: [BigInt(major), BigInt(minor), BigInt(patch)],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    // A shorter set of otherwise equal identifiers has lower precedence.
    if (a === undefined) return -1;
    if (b === undefined) return 1;

    const aNumeric = NUMERIC.test(a);
    const bNumeric = NUMERIC.test(b);
    if (aNumeric && bNumeric) {
      const leftNumber = BigInt(a);
      const rightNumber = BigInt(b);
      if (leftNumber < rightNumber) return -1;
      if (leftNumber > rightNumber) return 1;
      continue;
    }
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

export interface PackFileMismatch {
  readonly path: string;
  readonly reason: "missing" | "hash" | "size";
}

/**
 * Do the bytes on disk match the files the manifest lists?
 *
 * `read` returns the file's bytes, or `null` when it is not there. The size is checked
 * before the hash because it is free, and a size mismatch means the hash cannot match.
 */
export async function verifyPackFiles(
  manifest: PackManifest,
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<readonly PackFileMismatch[]> {
  const mismatches: PackFileMismatch[] = [];
  for (const file of manifest.files) {
    const bytes = await read(file.path);
    if (bytes === null) {
      mismatches.push({ path: file.path, reason: "missing" });
      continue;
    }
    if (bytes.byteLength !== file.bytes) {
      mismatches.push({ path: file.path, reason: "size" });
      continue;
    }
    if ((await sha256Hex(bytes)) !== file.sha256) {
      mismatches.push({ path: file.path, reason: "hash" });
    }
  }
  return mismatches;
}

/**
 * Can this host run this pack?
 *
 * Mirrors the desktop's `manifestFitsHub`: a pack built for a newer contract is refused
 * with a sentence a person can act on, rather than failing at the first missing host method.
 */
export type HostFit =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "contract" | "host" | "ring";
      readonly message: string;
    };

/**
 * May this pack make this request?
 *
 * `ready` and `theme` are always allowed: a pack that cannot ask what it is or how it looks
 * cannot render at all, and neither reveals anything the pack does not already have.
 */
export function packAllows(manifest: PackManifest, capability: PackCapability): boolean {
  return manifest.capabilities.includes(capability);
}

/**
 * Does this document forbid itself the network?
 *
 * `network` used to be described here as advisory, on the grounds that the host cannot stop a
 * same-origin pack from calling `fetch`. That was wrong in one specific and useful way: a pack's
 * **own** Content-Security-Policy is enforced by the browser for that document, whatever origin it
 * shares. So the host cannot block the request, but it can refuse to install a pack that has not
 * blocked it for itself — and because every file in a pack is hash-verified against the manifest,
 * what was checked at install is what runs later.
 *
 * Two directives are required, not one:
 *
 * - `connect-src 'none'` **or** `connect-src 'self'` — the first closes every fetch channel; the
 *   second is what a pack with WebAssembly actually needs, because wasm-bindgen loads its `.wasm`
 *   with `fetch()` and that request is same-origin. `'self'` cannot reach a remote origin, so the
 *   exfiltration channel that matters stays closed. **Measured:** `'none'` produces a blank frame
 *   for a pack that uses Loro, which is how this distinction was found.
 * - `default-src 'self'` (or `'none'`) — because `img-src`, `script-src` and the rest fall back to
 *   it. Without this, `<img src="https://elsewhere/?d=…">` is an exfiltration channel that
 *   `connect-src` does not close.
 *
 * Only a literal `'self'` or `'none'` is accepted for `default-src`. A policy naming any origin,
 * scheme or wildcard is refused rather than interpreted: the point is a rule a person can audit in
 * one line, not a CSP parser.
 *
 * The `content` attribute must be double-quoted, because a single-quoted one cannot contain
 * `'self'` — HTML would end the attribute at the first inner quote. Entities are not decoded, so a
 * templating system that writes `&#39;self&#39;` produces a policy this refuses, loudly, rather
 * than one it misreads.
 */
export function packDocumentSealsNetwork(html: string): boolean {
  const policies = [...html.matchAll(/<meta\b[^>]*>/giu)]
    .filter((match) => /http-equiv\s*=\s*["']?content-security-policy["']?/iu.test(match[0]))
    .map((match) => /content\s*=\s*("([^"]*)"|'([^']*)')/iu.exec(match[0]))
    .flatMap((match) => (match === null ? [] : [match[2] ?? match[3] ?? ""]));

  return policies.some((policy) => {
    const directives = new Map<string, string>();
    for (const part of policy.split(";")) {
      const [name, ...values] = part.trim().split(/\s+/u);
      if (name === undefined || name.length === 0) continue;
      directives.set(name.toLowerCase(), values.join(" ").toLowerCase());
    }
    const connect = directives.get("connect-src") ?? "";
    const fallback = directives.get("default-src") ?? "";
    const sealedFallback = fallback === "'self'" || fallback === "'none'";
    const sealedConnect = connect === "'none'" || connect === "'self'";
    return sealedFallback && sealedConnect;
  });
}

export type NetworkPolicyCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** The exact origins a pack may reach. Empty when it does not declare `network`. */
export function networkAllowlist(
  manifest: Pick<PackManifestCore, "network" | "capabilities">,
): readonly string[] {
  if (!manifest.capabilities.includes("network")) return [];
  return manifest.network?.allow ?? [];
}

/** The `connect-src` value the host derives from a pack's allowlist (S4.4). */
export function connectSrcPolicy(allow: readonly string[]): string {
  return ["connect-src", ...allow].join(" ");
}

/**
 * Does this pack honour the network rule it declared?
 *
 * Two answers matter. A pack that declares `network` must carry a non-empty
 * exact-origin allowlist; without one the declaration would mean "reach
 * anything" and the install is refused. A pack that does not declare it has to
 * prove it cannot reach the network, because the alternative is a capability
 * model where one of the words means nothing.
 */
export function checkNetworkPolicy(
  manifest: PackManifest,
  files: Readonly<Record<string, Uint8Array>>,
): NetworkPolicyCheck {
  if (packAllows(manifest, "network")) {
    const allow = networkAllowlist(manifest);
    if (allow.length === 0) {
      return {
        ok: false,
        message:
          `${manifest.name} declares the "network" capability but carries no network.allow list. ` +
          "S4.4 makes network an exact-origin allowlist, so an empty list is refused rather than " +
          "read as permission to reach anything.",
      };
    }
    return { ok: true };
  }

  const entry = files[manifest.entry];
  if (entry === undefined) {
    return { ok: false, message: `${manifest.entry} is not in this pack` };
  }
  if (!packDocumentSealsNetwork(new TextDecoder().decode(entry))) {
    return {
      ok: false,
      message:
        `${manifest.name} does not declare the "network" capability, so ${manifest.entry} must ` +
        `carry <meta http-equiv="Content-Security-Policy"> with default-src 'self' and ` +
        `connect-src 'none' (or 'self' when it loads its own WebAssembly). Declare the capability ` +
        "instead if the pack really needs the network.",
    };
  }
  return { ok: true };
}

/** The ring a manifest declares, with an absent value meaning `stable`. */
export function packRing(manifest: Pick<PackManifestCore, "ring">): PackRing {
  return manifest.ring ?? DEFAULT_PACK_RING;
}

/** The host floor a manifest declares, under either spelling. */
export function packMinimumHost(
  manifest: Pick<PackManifestCore, "minHost" | "minimumHostVersion">,
): number | undefined {
  return manifest.minHost ?? manifest.minimumHostVersion;
}

export interface HostContract {
  readonly contractVersion: number;
  readonly hostVersion: number;
  /**
   * The rings this host offers. Absent means `stable` alone (S12.10); preview is
   * added only by an explicit host setting, never by a pack.
   */
  readonly rings?: readonly PackRing[];
}

export function packFitsHost(manifest: PackManifest, host: HostContract): HostFit {
  if (manifest.contractVersion > host.contractVersion) {
    return {
      ok: false,
      reason: "contract",
      message: `${manifest.name} needs a newer version of Suite Go. Update the app to open it.`,
    };
  }
  const minimumHost = packMinimumHost(manifest);
  if (minimumHost !== undefined && host.hostVersion < minimumHost) {
    return {
      ok: false,
      reason: "host",
      message: `${manifest.name} needs Suite Go ${minimumHost} or later; this host is ${host.hostVersion}.`,
    };
  }
  const ring = packRing(manifest);
  const offered = host.rings ?? [DEFAULT_PACK_RING];
  if (!offered.includes(ring)) {
    return {
      ok: false,
      reason: "ring",
      message: `${manifest.name} is a ${ring} ring pack; Suite Go offers ${offered.join(" and ") || "no ring"}.`,
    };
  }
  return { ok: true };
}
