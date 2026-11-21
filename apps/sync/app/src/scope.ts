import type { NetworkInterfaceInfo } from "node:os";

/**
 * Who can reach the relay.
 *
 * The relay is trust-all by design: it has no device registry, so a device that can reach the port
 * and knows a workspace id can claim a role in that workspace's mailbox. Admission is therefore the
 * bind, not a check inside the relay — and the bind is a choice a person makes, not a default that
 * quietly widens. Loopback is the default; the tailnet is the reach a person with Tailscale already
 * has; the whole network is a deliberate, confirmed choice.
 *
 * Everything here is pure so a test can read the decision without a socket or a display.
 */

export type RelayScope = "loopback" | "tailnet" | "network";

export const RELAY_SCOPES: readonly RelayScope[] = ["loopback", "tailnet", "network"];

export const DEFAULT_SCOPE: RelayScope = "loopback";

/** Tailscale's own interface name on Linux. */
export const TAILNET_INTERFACE = "tailscale0";

export const TAILNET_MISSING = "Tailscale is not running on this machine.";

export type InterfaceTable = NodeJS.Dict<NetworkInterfaceInfo[]>;

export function isRelayScope(value: unknown): value is RelayScope {
  return typeof value === "string" && (RELAY_SCOPES as readonly string[]).includes(value);
}

/** The sentence a person reads for each reach. These are the product's words, not a log line. */
export function scopeSentence(scope: RelayScope): string {
  switch (scope) {
    case "loopback":
      return "Only this device can reach the relay.";
    case "tailnet":
      return "Only devices on your tailnet can reach it.";
    case "network":
      return "Any device on this network can write to the relay.";
  }
}

function familyOf(info: NetworkInterfaceInfo): string {
  // `os.networkInterfaces()` reports "IPv4"/"IPv6"; an older numeric shape is accepted too.
  return String(info.family);
}

/**
 * The IPv4 address Tailscale gave this machine, or null.
 *
 * `tailscale0` is the interface Tailscale's userspace and kernel modes both create. Enumerating it
 * needs no `tailscale` binary, no login and no extra grant: the Flatpak shares the host's network
 * namespace, so the interface is simply there when Tailscale is running.
 */
export function tailnetAddress(interfaces: InterfaceTable): string | null {
  for (const info of interfaces[TAILNET_INTERFACE] ?? []) {
    const family = familyOf(info);
    if ((family === "IPv4" || family === "4") && !info.internal && info.address.length > 0) {
      return info.address;
    }
  }
  return null;
}

/** What the relay will actually bind, and what that exposes. */
export interface RelayTarget {
  /** The scope the person chose. */
  readonly scope: RelayScope;
  /**
   * What the bind exposes. `tailnet` falls back to `loopback` when Tailscale is not running, so
   * this is what the window says out loud; it is never a promise the bind does not keep.
   */
  readonly effective: RelayScope;
  readonly bind: string;
  /** True when `SUITE_SYNC_BIND` decides the bind and the stored scope cannot. */
  readonly locked: boolean;
  /** A sentence about why the chosen scope is not the effective one. */
  readonly problem: string | null;
}

function scopeForBind(bind: string, chosen: RelayScope): RelayScope {
  const normalized = bind.trim().toLowerCase();
  if (normalized === "0.0.0.0" || normalized === "::") return "network";
  if (normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1") {
    return "loopback";
  }
  return chosen === "network" ? "tailnet" : chosen;
}

/**
 * Resolve the chosen scope into the address to bind.
 *
 * `envBind` is the test and host override: a machine or a smoke test that names an address gets that
 * address, whatever the stored scope says. The CLI already has the same flag shape, so the override
 * is one variable a person can reason about.
 */
export function resolveRelayTarget(options: {
  readonly scope: RelayScope;
  readonly envBind?: string | null;
  readonly interfaces: InterfaceTable;
}): RelayTarget {
  const override = (options.envBind ?? "").trim();
  if (override.length > 0) {
    return {
      scope: options.scope,
      effective: scopeForBind(override, options.scope),
      bind: override,
      locked: true,
      problem: null,
    };
  }

  if (options.scope === "network") {
    return {
      scope: options.scope,
      effective: "network",
      bind: "0.0.0.0",
      locked: false,
      problem: null,
    };
  }

  if (options.scope === "tailnet") {
    const address = tailnetAddress(options.interfaces);
    if (address === null) {
      // Refuse the tailnet bind rather than serve something wider. The relay stays reachable on
      // this machine and the window says why the tailnet is not.
      return {
        scope: options.scope,
        effective: "loopback",
        bind: "127.0.0.1",
        locked: false,
        problem: TAILNET_MISSING,
      };
    }
    return {
      scope: options.scope,
      effective: "tailnet",
      bind: address,
      locked: false,
      problem: null,
    };
  }

  return {
    scope: options.scope,
    effective: "loopback",
    bind: "127.0.0.1",
    locked: false,
    problem: null,
  };
}

/** One row of the window's selector. */
export interface ScopeOption {
  readonly id: RelayScope;
  readonly label: string;
  readonly sentence: string;
  /** The warning style the network scope carries wherever it is shown. */
  readonly warning: boolean;
  /** The person must pass through a confirmation before this takes effect. */
  readonly needsConfirmation: boolean;
  readonly available: boolean;
  /** Why the option cannot be chosen, when it cannot. */
  readonly detail: string | null;
}

/**
 * The three options the window draws.
 *
 * `needsConfirmation` is computed here rather than in the page, so the page obeying the flag and the
 * main process refusing an unacknowledged change are the same decision.
 */
export function scopeOptions(options: {
  readonly scope: RelayScope;
  readonly locked: boolean;
  readonly interfaces: InterfaceTable;
}): readonly ScopeOption[] {
  const tailnetReady = tailnetAddress(options.interfaces) !== null;
  return [
    {
      id: "loopback",
      label: "This device only",
      sentence: scopeSentence("loopback"),
      warning: false,
      needsConfirmation: false,
      available: true,
      detail: null,
    },
    {
      id: "tailnet",
      label: "My tailnet",
      sentence: scopeSentence("tailnet"),
      warning: false,
      needsConfirmation: false,
      available: tailnetReady,
      detail: tailnetReady ? null : TAILNET_MISSING,
    },
    {
      id: "network",
      label: "This network",
      sentence: scopeSentence("network"),
      warning: true,
      needsConfirmation: options.scope !== "network",
      available: true,
      detail: null,
    },
  ];
}

export type ScopeChangeRefusal = "acknowledgement-required";

/**
 * Whether a scope change may take effect.
 *
 * Selecting the network scope is the acknowledgement the CLI's `--trust-all-remote` asks for. Once
 * it is stored, a restart does not ask again: the persisted choice is the opt-in. Going back to
 * loopback never asks.
 */
export function checkScopeChange(options: {
  readonly from: RelayScope;
  readonly to: RelayScope;
  readonly acknowledged: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly reason: ScopeChangeRefusal } {
  const needs = options.to === "network" && options.from !== "network";
  if (needs && !options.acknowledged) {
    return { ok: false, reason: "acknowledgement-required" };
  }
  return { ok: true };
}
