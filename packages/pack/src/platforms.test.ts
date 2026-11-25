import { describe, expect, it } from "vitest";
import { GO_HOST, hostsOfKind, platformFit, SHELL_HOST } from "./platforms.js";

describe("platform fit", () => {
  // spec: S3.5
  it("is available when the host kind is declared and every capability is served", () => {
    const fit = platformFit(
      { platforms: ["desktop"], capabilities: ["documents", "files"] },
      SHELL_HOST,
    );
    expect(fit.state).toBe("available");
    expect(fit.reason).toBeNull();
    expect(fit.missingCapabilities).toEqual([]);
  });

  // spec: S4.8
  it("names the capability a declared platform cannot get", () => {
    const fit = platformFit({ platforms: ["desktop", "mobile"], capabilities: ["relay"] }, GO_HOST);
    expect(fit.state).toBe("unavailable");
    expect(fit.reason).toBe("not available on Go — needs `relay`");
    expect(fit.missingCapabilities).toEqual(["relay"]);
  });

  // spec: S4.8 — Go serves its own scoped file store, so a pack that needs one installs.
  it("serves files on the phone as well as the desktop", () => {
    const fit = platformFit(
      { platforms: ["desktop", "mobile"], capabilities: ["documents", "files"] },
      GO_HOST,
    );
    expect(fit.state).toBe("available");
    expect(fit.missingCapabilities).toEqual([]);
  });

  // spec: S3.5
  it("names the kind when the pack does not declare this host at all", () => {
    const fit = platformFit({ platforms: ["desktop"], capabilities: [] }, GO_HOST);
    expect(fit.state).toBe("unavailable");
    expect(fit.reason).toBe("not available on Go — built for `desktop`");
  });

  // spec: S3.5
  it("treats a manifest without platforms as unknown, never available", () => {
    const fit = platformFit({ capabilities: ["documents"] }, GO_HOST);
    expect(fit.state).toBe("unknown");
    expect(fit.platforms).toBeNull();
    expect(fit.reason).toContain("declares no platforms");
  });

  // spec: S4.8
  it("still refuses a missing capability when the platform declaration is absent", () => {
    const fit = platformFit({ capabilities: ["commands"] }, GO_HOST);
    expect(fit.state).toBe("unavailable");
    expect(fit.reason).toBe("not available on Go — needs `commands`");
  });

  // spec: S3.5
  it("finds a host by kind without closing the vocabulary", () => {
    expect(hostsOfKind("mobile")).toEqual([GO_HOST]);
    expect(hostsOfKind("tv")).toEqual([]);
    expect(platformFit({ platforms: ["tv"], capabilities: [] }, SHELL_HOST).state).toBe(
      "unavailable",
    );
  });
});
