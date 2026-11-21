import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
  checkScopeChange,
  resolveRelayTarget,
  scopeOptions,
  scopeSentence,
  TAILNET_MISSING,
  tailnetAddress,
} from "./scope.js";

function iface(
  address: string,
  options: { readonly internal?: boolean; readonly family?: "IPv4" | "IPv6" } = {},
): NetworkInterfaceInfo {
  const base = {
    address,
    netmask: "255.255.255.0",
    mac: "00:00:00:00:00:00",
    internal: options.internal ?? false,
    cidr: `${address}/24`,
  };
  if (options.family === "IPv6") return { ...base, family: "IPv6", scopeid: 0 };
  return { ...base, family: "IPv4" };
}

const tailscaleUp = {
  tailscale0: [iface("100.101.102.103"), iface("fd7a:115c:a1e0::1", { family: "IPv6" })],
  eth0: [iface("192.168.1.20")],
};

const tailscaleDown = {
  lo: [iface("127.0.0.1", { internal: true })],
  eth0: [iface("192.168.1.20")],
};

describe("the tailnet address", () => {
  it("is the first IPv4 Tailscale gave this machine", () => {
    expect(tailnetAddress(tailscaleUp)).toBe("100.101.102.103");
  });

  it("is null when Tailscale is not running", () => {
    expect(tailnetAddress(tailscaleDown)).toBeNull();
    expect(tailnetAddress({})).toBeNull();
  });

  it("ignores an internal or IPv6-only tailscale0", () => {
    expect(tailnetAddress({ tailscale0: [iface("100.64.0.1", { internal: true })] })).toBeNull();
    expect(tailnetAddress({ tailscale0: [iface("fd7a::1", { family: "IPv6" })] })).toBeNull();
  });
});

describe("the bind each scope resolves to", () => {
  it("is loopback by default", () => {
    const target = resolveRelayTarget({ scope: "loopback", interfaces: tailscaleUp });
    expect(target).toEqual({
      scope: "loopback",
      effective: "loopback",
      bind: "127.0.0.1",
      locked: false,
      problem: null,
    });
  });

  it("is the tailnet address when Tailscale is running", () => {
    const target = resolveRelayTarget({ scope: "tailnet", interfaces: tailscaleUp });
    expect(target.bind).toBe("100.101.102.103");
    expect(target.effective).toBe("tailnet");
    expect(target.problem).toBeNull();
  });

  it("stays loopback and says why when Tailscale is not running", () => {
    const target = resolveRelayTarget({ scope: "tailnet", interfaces: tailscaleDown });
    expect(target.bind).toBe("127.0.0.1");
    expect(target.effective).toBe("loopback");
    expect(target.problem).toBe(TAILNET_MISSING);
    expect(target.problem).toBe("Tailscale is not running on this machine.");
  });

  it("is every interface only for the network scope", () => {
    const target = resolveRelayTarget({ scope: "network", interfaces: tailscaleDown });
    expect(target.bind).toBe("0.0.0.0");
    expect(target.effective).toBe("network");
  });

  it("lets SUITE_SYNC_BIND win, and marks the scope locked", () => {
    const target = resolveRelayTarget({
      scope: "network",
      envBind: "127.0.0.1",
      interfaces: tailscaleDown,
    });
    expect(target.bind).toBe("127.0.0.1");
    expect(target.effective).toBe("loopback");
    expect(target.locked).toBe(true);
  });

  it("treats an empty override as no override", () => {
    const target = resolveRelayTarget({
      scope: "tailnet",
      envBind: "   ",
      interfaces: tailscaleUp,
    });
    expect(target.locked).toBe(false);
    expect(target.bind).toBe("100.101.102.103");
  });
});

describe("a literal bind is classified by the address, never by the stored scope", () => {
  function effective(scope: "loopback" | "tailnet" | "network", envBind: string): string {
    return resolveRelayTarget({ scope, envBind, interfaces: tailscaleUp }).effective;
  }

  it("reads a LAN literal as the network reach even when loopback is stored", () => {
    expect(effective("loopback", "192.168.1.20")).toBe("network");
  });

  it("reads a tailnet literal as the tailnet reach under a stored loopback", () => {
    expect(effective("loopback", "100.101.102.103")).toBe("tailnet");
  });

  it("reads a tailnet literal as the tailnet reach under a stored network", () => {
    expect(effective("network", "100.101.102.103")).toBe("tailnet");
  });

  it("reads the wildcard as the network reach under every stored scope", () => {
    expect(effective("loopback", "0.0.0.0")).toBe("network");
    expect(effective("tailnet", "0.0.0.0")).toBe("network");
    expect(effective("network", "0.0.0.0")).toBe("network");
    expect(effective("loopback", "::")).toBe("network");
  });

  it("reads any loopback literal as loopback under any stored scope", () => {
    expect(effective("network", "127.0.0.1")).toBe("loopback");
    expect(effective("network", "127.0.0.5")).toBe("loopback");
    expect(effective("tailnet", "localhost")).toBe("loopback");
    expect(effective("network", "::1")).toBe("loopback");
  });

  it("falls back to the widest reach for an address it cannot place", () => {
    expect(effective("loopback", "myhost.lan")).toBe("network");
    expect(effective("loopback", "203.0.113.7")).toBe("network");
  });
});

describe("the words for each reach", () => {
  it("says what the bind exposes", () => {
    expect(scopeSentence("loopback")).toBe("Only this device can reach the relay.");
    expect(scopeSentence("tailnet")).toBe("Only devices on your tailnet can reach it.");
    expect(scopeSentence("network")).toBe("Any device on this network can write to the relay.");
  });

  it("offers all three, with the warning on the network one", () => {
    const options = scopeOptions({ scope: "loopback", locked: false, interfaces: tailscaleUp });
    expect(options.map((option) => option.id)).toEqual(["loopback", "tailnet", "network"]);
    expect(options.filter((option) => option.warning).map((option) => option.id)).toEqual([
      "network",
    ]);
  });

  it("disables the tailnet option, with the reason, when Tailscale is not running", () => {
    const options = scopeOptions({ scope: "loopback", locked: false, interfaces: tailscaleDown });
    const tailnet = options.find((option) => option.id === "tailnet");
    expect(tailnet?.available).toBe(false);
    expect(tailnet?.detail).toBe(TAILNET_MISSING);
  });

  it("asks for a confirmation only when the network scope is not already in force", () => {
    const before = scopeOptions({ scope: "loopback", locked: false, interfaces: tailscaleUp });
    const after = scopeOptions({ scope: "network", locked: false, interfaces: tailscaleUp });
    expect(before.find((option) => option.id === "network")?.needsConfirmation).toBe(true);
    expect(after.find((option) => option.id === "network")?.needsConfirmation).toBe(false);
  });
});

describe("changing the reach", () => {
  it("refuses the network scope without the confirmation", () => {
    expect(checkScopeChange({ from: "loopback", to: "network", acknowledged: false })).toEqual({
      ok: false,
      reason: "acknowledgement-required",
    });
  });

  it("accepts it once confirmed", () => {
    expect(checkScopeChange({ from: "loopback", to: "network", acknowledged: true })).toEqual({
      ok: true,
    });
  });

  it("never asks again while the network scope is already stored", () => {
    expect(checkScopeChange({ from: "network", to: "network", acknowledged: false })).toEqual({
      ok: true,
    });
  });

  it("never asks for a narrower reach", () => {
    expect(checkScopeChange({ from: "network", to: "loopback", acknowledged: false })).toEqual({
      ok: true,
    });
    expect(checkScopeChange({ from: "network", to: "tailnet", acknowledged: false })).toEqual({
      ok: true,
    });
  });
});
