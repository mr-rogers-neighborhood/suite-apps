import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyReleaseView } from "./android-release.mjs";

describe("release lookup", () => {
  it("treats a successful read as present", () => {
    assert.deepEqual(classifyReleaseView({ status: 0 }), { state: "present", detail: null });
  });

  it("calls a release gh reports missing 'missing'", () => {
    assert.equal(
      classifyReleaseView({ status: 1, stderr: "release not found" }).state,
      "missing",
    );
  });

  it("calls a missing or unauthenticated gh 'unavailable', not 'missing'", () => {
    const notInstalled = classifyReleaseView({ status: 1, stderr: "gh: command not found" });
    assert.equal(notInstalled.state, "unavailable");

    const spawnFailed = classifyReleaseView({
      error: new Error("spawn gh ENOENT"),
      status: null,
    });
    assert.equal(spawnFailed.state, "unavailable");
    assert.match(spawnFailed.detail, /ENOENT/u);

    const unauthenticated = classifyReleaseView({
      status: 1,
      stderr: "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.",
    });
    assert.equal(unauthenticated.state, "unavailable");
  });
});
