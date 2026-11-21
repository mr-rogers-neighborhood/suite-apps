import { describe, expect, it } from "vitest";
import { hostFor } from "./host.js";
import { launchCommand, launchIntent, MANAGED_BY_ENV, stopApproach } from "./launchCommand.js";

/**
 * What a launch would run, in both forms.
 *
 * The AppImage path is unchanged: the binary and its arguments. The Flatpak path
 * puts the CLI in front. The sandbox adds the one thing that differs between a
 * host and a Flatpak: `flatpak-spawn --host`, with the managed-by variable as an
 * argv element rather than a shell assignment.
 */

const APP_IMAGE = "/home/me/Applications/Suite/Canvas/0.1.0/suite-canvas.AppImage";
const FLATPAK = "/usr/bin/flatpak";

describe("launchCommand", () => {
  it("is the AppImage and its arguments", () => {
    expect(launchCommand({ executable: APP_IMAGE }, ["suite://canvas/card/1"])).toEqual({
      command: APP_IMAGE,
      args: ["suite://canvas/card/1"],
    });
  });

  it("starts a Flatpak through the CLI that owns it", () => {
    expect(
      launchCommand(
        { executable: FLATPAK, flatpak: { application: "run.suite.canvas", installation: "user" } },
        ["suite://canvas/card/1"],
      ),
    ).toEqual({
      command: FLATPAK,
      args: ["run", "run.suite.canvas", "suite://canvas/card/1"],
    });
  });
});

describe("launchIntent", () => {
  it("carries the managed-by variable only when Start is the one starting it", () => {
    expect(launchIntent({ executable: APP_IMAGE }, [])).toEqual({
      file: APP_IMAGE,
      args: [],
    });
    expect(launchIntent({ executable: APP_IMAGE }, [], { managed: true })).toEqual({
      file: APP_IMAGE,
      args: [],
      env: { [MANAGED_BY_ENV]: "start" },
    });
  });
});

describe("planning a launch in the sandbox", () => {
  it("runs the AppImage on the host, with the same argv", () => {
    const host = hostFor(true);
    expect(
      host.plan(
        launchIntent({ executable: APP_IMAGE }, ["suite://canvas/card/1"], { managed: true }),
      ),
    ).toEqual({
      file: "flatpak-spawn",
      args: ["--host", `--env=${MANAGED_BY_ENV}=start`, APP_IMAGE, "suite://canvas/card/1"],
    });
  });

  it("runs the Flatpak CLI on the host too, rather than a second CLI inside the sandbox", () => {
    const host = hostFor(true);
    expect(
      host.plan(
        launchIntent(
          {
            executable: FLATPAK,
            flatpak: { application: "run.suite.canvas", installation: "user" },
          },
          ["suite://canvas/card/1"],
        ),
      ),
    ).toEqual({
      file: "flatpak-spawn",
      args: ["--host", FLATPAK, "run", "run.suite.canvas", "suite://canvas/card/1"],
    });
  });

  it("leaves a direct host's plan exactly as the backend built it", () => {
    const host = hostFor(false);
    const intent = launchIntent({ executable: APP_IMAGE }, ["a"], { managed: true });
    expect(host.plan(intent)).toBe(intent);
  });
});

describe("stopApproach", () => {
  it("keeps the host's SIGTERM for an AppImage and for a Flatpak", () => {
    // Signalling the pid is what today's AppImage build does, and that must not
    // change just because a sandboxed form learned a second way.
    expect(stopApproach({ sandboxed: false, flatpak: false })).toBe("signal");
    expect(stopApproach({ sandboxed: false, flatpak: true })).toBe("signal");
  });

  it("closes a Flatpak by id in a sandbox, and hands an AppImage to the person", () => {
    // The pid here is flatpak-spawn's, so a signal reaches the helper and not the
    // app. `flatpak kill` addresses the app; an AppImage has no such handle.
    expect(stopApproach({ sandboxed: true, flatpak: true })).toBe("flatpak-kill");
    expect(stopApproach({ sandboxed: true, flatpak: false })).toBe("manual");
  });
});
