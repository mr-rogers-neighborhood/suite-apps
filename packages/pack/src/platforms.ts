import type { PackCapability } from "./capabilities.js";

/**
 * Host kinds and platform fit.
 *
 * `platforms` in a manifest is a declaration of intent: which host kinds the
 * pack is meant for. A host declares what it is — its kind and the capabilities
 * it actually serves — and the catalogue compares the two. The pack does not get
 * to say which capabilities this host implements, and a host does not get to
 * pretend it is another kind.
 *
 * Host kinds are an open vocabulary. `desktop` and `mobile` are today's hosts,
 * not the limit: a television, tablet, foldable, headset or car display is the
 * same question. A value this parser does not know is still a safe, opaque value;
 * it simply matches no host that has not declared that kind. That exception to
 * strict enum parsing is deliberate (see `manifest.schema.json`), because
 * rejecting the whole manifest would make a pack uninstallable everywhere.
 */

/** A host kind a host reports about itself, or a pack names in `platforms`. Opaque by design. */
export type HostKind = string;

/** One value in a pack's `platforms` declaration. The same open vocabulary as `HostKind`. */
export type PackPlatform = string;

const PLATFORM_KIND = /^[a-z][a-z0-9-]{0,31}$/u;

/** A lowercase kind such as `desktop`, `mobile`, `tv`, `tablet`, `foldable` or `xr`. */
export function isSafePackPlatform(value: unknown): value is PackPlatform {
  return typeof value === "string" && PLATFORM_KIND.test(value);
}

/**
 * What one host is and what it actually serves.
 *
 * The capability list is a fact about this build, not a wish: a capability is
 * here only when a request for it has an enforcement point. The two hosts share
 * the declaration shape so the catalogue compares them with one rule instead of
 * copying a list into each catalogue.
 */
export interface HostDeclaration {
  /** A stable id for logs and tests; not a pack id. */
  readonly id: string;
  /** The name a person sees in a refusal: "Suite", "Go". */
  readonly name: string;
  /** The kind this host reports about itself. */
  readonly kind: HostKind;
  /** The capabilities this host serves today. A pack asking for more is refused. */
  readonly capabilities: readonly PackCapability[];
}

/** The desktop shell: Electron, its document and file services, and the pack bridge. */
export const SHELL_HOST = {
  id: "shell",
  name: "Suite",
  kind: "desktop",
  capabilities: ["documents", "files", "identity.pack", "network", "notifications", "recents"],
} as const satisfies HostDeclaration;

/**
 * Suite Go on a phone. It serves its own scoped file store, so a pack that
 * declares `files` is mobile-ready; the picker and share sheet are the
 * person-consented half of the same capability.
 */
export const GO_HOST = {
  id: "go",
  name: "Go",
  kind: "mobile",
  capabilities: ["documents", "files", "storage", "recents", "notifications", "network"],
} as const satisfies HostDeclaration;

/** Every host build in this tree, for a checker that needs to judge a declaration. */
export const HOST_DECLARATIONS: readonly HostDeclaration[] = [SHELL_HOST, GO_HOST];

/** The hosts that report a kind, in declaration order. Empty means this tree has no such host. */
export function hostsOfKind(kind: HostKind): readonly HostDeclaration[] {
  return HOST_DECLARATIONS.filter((host) => host.kind === kind);
}

/**
 * The pack fields a fit depends on.
 *
 * `platforms` is optional because a pack built before the field existed has no
 * declaration. That state is "unknown", never "available": treating an absent
 * declaration as universal is how the first mobile install fails at launch.
 */
export interface PackPlatformClaim {
  readonly platforms?: readonly string[];
  readonly capabilities: readonly PackCapability[];
}

export type PlatformFitState = "available" | "unavailable" | "unknown";

export interface PlatformFit {
  /** `unknown` when the pack declares nothing; it is never reported as `available`. */
  readonly state: PlatformFitState;
  /** The declaration, or null when the manifest has none. */
  readonly platforms: readonly string[] | null;
  readonly hostKind: HostKind;
  readonly hostName: string;
  /** Required capabilities this host does not serve. Empty when every one is covered. */
  readonly missingCapabilities: readonly PackCapability[];
  /** A sentence for the catalogue; null only when the state is `available`. */
  readonly reason: string | null;
}

function hostCanRunKind(host: HostDeclaration, declared: readonly string[]): boolean {
  return declared.includes(host.kind);
}

function quotedCapabilities(capabilities: readonly PackCapability[]): string {
  return capabilities.map((capability) => `\`${capability}\``).join(", ");
}

function quotedPlatforms(platforms: readonly string[]): string {
  return platforms.map((platform) => `\`${platform}\``).join(", ");
}

/**
 * Compare a pack's declaration with one host.
 *
 * Three outcomes, and the third is the one that must not become "supported":
 *
 * - `available`: the host's kind is declared and every required capability is served.
 * - `unavailable`: the kind is not declared, or a required capability is missing. The
 *   reason names whichever facts apply, so a refusal is actionable (S4.8).
 * - `unknown`: the manifest has no `platforms`. An older pack is not universal; the
 *   catalogue says so instead of guessing.
 *
 * A missing capability is checked even when `platforms` is absent: the index may
 * carry capabilities without a platform declaration, and a capability this host
 * cannot serve is a definite refusal.
 */
export function platformFit(claim: PackPlatformClaim, host: HostDeclaration): PlatformFit {
  const declared =
    claim.platforms === undefined || claim.platforms.length === 0 ? null : claim.platforms;
  const missingCapabilities = claim.capabilities.filter(
    (capability) => !host.capabilities.includes(capability),
  );
  const wrongKind = declared !== null && !hostCanRunKind(host, declared);

  if (missingCapabilities.length > 0 || wrongKind) {
    const facts: string[] = [];
    if (wrongKind && declared !== null) facts.push(`built for ${quotedPlatforms(declared)}`);
    if (missingCapabilities.length > 0) {
      facts.push(`needs ${quotedCapabilities(missingCapabilities)}`);
    }
    return {
      state: "unavailable",
      platforms: declared,
      hostKind: host.kind,
      hostName: host.name,
      missingCapabilities,
      reason: `not available on ${host.name} — ${facts.join(" and ")}`,
    };
  }

  if (declared === null) {
    return {
      state: "unknown",
      platforms: null,
      hostKind: host.kind,
      hostName: host.name,
      missingCapabilities,
      reason: `platform unknown — this pack declares no platforms; it may not run on ${host.name}`,
    };
  }

  return {
    state: "available",
    platforms: declared,
    hostKind: host.kind,
    hostName: host.name,
    missingCapabilities,
    reason: null,
  };
}

/** The shape an IPC boundary carries. The host-only analysis stays in `PlatformFit`. */
export interface PlatformFitView {
  readonly state: PlatformFitState;
  /** A sentence for the chrome; null when the state is `available`. */
  readonly reason: string | null;
}

export function platformFitView(fit: PlatformFit): PlatformFitView {
  return { state: fit.state, reason: fit.reason };
}
