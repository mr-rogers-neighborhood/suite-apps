import { describe, expect, it } from "vitest";
import {
  appIdFor,
  isPreReleaseDataPath,
  isPreReleaseId,
  isPreReleaseTier,
  PRE_RELEASE_DOCUMENTS_FOLDER,
  preReleaseDataDirectory,
  preReleaseIdFor,
  preReleaseNotice,
  preReleaseRemovalCopy,
  tierForInstall,
  tierFromBranch,
  tierFromChannel,
} from "./channels.js";

describe("the pre-release identity", () => {
  it("is one id shared by every tier", () => {
    expect(preReleaseIdFor("canvas")).toBe("slop-canvas");
    expect(isPreReleaseId("slop-canvas")).toBe(true);
    expect(isPreReleaseId("canvas")).toBe(false);
    expect(appIdFor("slop-canvas")).toBe("canvas");
    expect(appIdFor("canvas")).toBe("canvas");
  });

  it("still reads the legacy dot form an installed build wrote", () => {
    // A manifest written before the id became canonical is not rewritten in place,
    // and calling it stable would hand it the stable documents folder.
    expect(isPreReleaseId("slop.canvas")).toBe(true);
    expect(appIdFor("slop.canvas")).toBe("canvas");
    expect(tierForInstall({ id: "slop.canvas", branch: "canary" })).toBe("canary");
  });

  it("does not take a bare prefix for an app", () => {
    expect(isPreReleaseId("slop-")).toBe(false);
    expect(isPreReleaseId("slop.")).toBe(false);
  });

  it("takes the tier from the ref branch, not from a version", () => {
    expect(tierFromBranch("slop")).toBe("slop");
    expect(tierFromBranch("canary")).toBe("canary");
    expect(tierFromBranch("beta")).toBe("beta");
    expect(tierFromBranch("stable")).toBeNull();
    expect(tierFromBranch("master")).toBeNull();
    expect(isPreReleaseTier("beta")).toBe(true);
    expect(isPreReleaseTier("alpha")).toBe(false);
  });
});

describe("tierForInstall", () => {
  it("calls a stable id stable whatever its feed channel says", () => {
    expect(tierForInstall({ id: "canvas", channel: "alpha" })).toBe("stable");
  });

  it("reads a pre-release branch first and a manifest channel second", () => {
    expect(tierForInstall({ id: "slop-canvas", branch: "canary" })).toBe("canary");
    expect(tierForInstall({ id: "slop-canvas", channel: "beta" })).toBe("beta");
    // No branch and no identity is still the first pre-release tier, never stable.
    expect(tierForInstall({ id: "slop-canvas" })).toBe("slop");
    expect(tierFromChannel("alpha")).toBe("slop");
  });
});

describe("the pre-release notice", () => {
  it("names the tier, the risk and the removal path", () => {
    const notice = preReleaseNotice("canary");
    expect(notice).toContain("Canary");
    expect(notice).toContain("may be broken");
    expect(notice).toContain("uninstalling asks before deleting it");
  });

  it("says a switch keeps the install and changes the data folder", () => {
    const notice = preReleaseNotice("slop", "canary");
    expect(notice).toContain("Switching to canary keeps this install");
    expect(notice).toContain("changes its data folder");
  });
});

describe("removal copy", () => {
  it("names the separate pre-release data and offers keeping it", () => {
    const copy = preReleaseRemovalCopy({
      name: "Suite Planner",
      tier: "beta",
      dataDirectory: "/home/me/Documents/Suite Slop/Planner",
    });
    expect(copy.message).toContain("beta");
    expect(copy.detail).toContain("separate");
    expect(copy.detail).toContain("/home/me/Documents/Suite Slop/Planner");
    expect(copy.detail).toContain("Stable documents are never touched");
    expect(copy.buttons).toEqual(["Cancel", "Uninstall, keep data", "Uninstall and delete data"]);
  });
});

describe("the pre-release data path", () => {
  it("is a sibling of Documents/Suite, not a child of it", () => {
    expect(preReleaseDataDirectory("/home/me/Documents/Suite", "Planner")).toBe(
      `/home/me/Documents/${PRE_RELEASE_DOCUMENTS_FOLDER}/Planner`,
    );
  });

  it("refuses a path outside the tree before removal", () => {
    const suiteRoot = "/home/me/Documents/Suite";
    expect(isPreReleaseDataPath(suiteRoot, "/home/me/Documents/Suite Slop/Planner")).toBe(true);
    expect(isPreReleaseDataPath(suiteRoot, "/home/me/Documents/Suite/Planner")).toBe(false);
    expect(isPreReleaseDataPath(suiteRoot, "/home/me/Documents/Suite Slop")).toBe(false);
  });
});
