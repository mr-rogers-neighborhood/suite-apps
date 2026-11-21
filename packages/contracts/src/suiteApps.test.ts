import { describe, expect, it } from "vitest";
import { suitePaths } from "./paths.js";
import { appDocumentsFolder, SUITE_APPS, suiteDocumentsRoot } from "./suiteApps.js";

const HOME = "/home/me";

describe("SUITE_APPS", () => {
  it("lists the document apps and the document-free Help app once each", () => {
    expect(SUITE_APPS.map((entry) => entry.id)).toEqual(["canvas", "planner", "budget", "help"]);
    expect(new Set(SUITE_APPS.map((entry) => entry.folder)).size).toBe(4);
  });

  it("claims an extension per document app and none for Help", () => {
    expect(SUITE_APPS.map((entry) => entry.extension)).toEqual([
      "canvas",
      "planner",
      "budget",
      null,
    ]);
  });
});

describe("appDocumentsFolder", () => {
  it("lands where the path convention already puts an app's documents", () => {
    for (const entry of SUITE_APPS) {
      expect(appDocumentsFolder(entry, { platform: "linux", home: HOME })).toBe(
        suitePaths(entry.folder, { platform: "linux", home: HOME }).documents,
      );
    }
  });

  it("keeps each app's folder under an overridden root", () => {
    expect(
      appDocumentsFolder(
        { folder: "Canvas" },
        { platform: "linux", home: HOME, rootOverride: "/tmp/box/documents" },
      ),
    ).toBe("/tmp/box/documents/Canvas");
  });

  it("uses the platform separator on Windows", () => {
    expect(
      appDocumentsFolder(
        { folder: "Budget" },
        { platform: "win32", home: "C:\\Users\\me", rootOverride: "C:\\tmp\\box" },
      ),
    ).toBe("C:\\tmp\\box\\Budget");
  });
});

describe("suiteDocumentsRoot", () => {
  it("is the folder every app's documents sit under", () => {
    expect(suiteDocumentsRoot("linux", HOME)).toBe("/home/me/Documents/Suite");
  });

  it("prefers an override and ignores an empty one", () => {
    expect(suiteDocumentsRoot("linux", HOME, "/tmp/box")).toBe("/tmp/box");
    expect(suiteDocumentsRoot("linux", HOME, "  ")).toBe("/home/me/Documents/Suite");
  });
});
