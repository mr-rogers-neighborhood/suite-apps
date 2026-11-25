import { createId } from "@suite/budget-core";
import { describe, expect, it } from "vitest";

import {
  type AppPaths,
  backupDir,
  budgetFromArgv,
  budgetFromLink,
  budgetPath,
  slopBudgetsFolder,
} from "./budgetLocation";

const paths: AppPaths = {
  root: "/home/me/.local/share/suite/budget",
  libraryFile: "/home/me/.local/share/suite/budget/library.json",
  budgetsDir: "/home/me/Documents/Suite/Budget",
  backupsDir: "/home/me/Documents/Suite/Budget/.backups",
  recoveredDir: "/home/me/.local/share/suite/budget/recovered",
  channel: "stable",
};

describe("budgetPath and backupDir", () => {
  it("builds a file and a backup folder for a normal id", () => {
    expect(budgetPath(paths, "b1")).toBe("/home/me/Documents/Suite/Budget/b1.budget");
    expect(backupDir(paths, "b1")).toBe("/home/me/Documents/Suite/Budget/.backups/b1");
    // The id helper's own shape has to pass, or every new budget would be refused.
    expect(() => budgetPath(paths, createId("budget"))).not.toThrow();
  });

  it.each([
    ["../escape", "a parent directory"],
    ["/tmp/escape", "an absolute path"],
    ["a/b", "a separator"],
    ["", "an empty id"],
    [".hidden", "a leading dot"],
    ["x".repeat(129), "an overlong id"],
    ["UPPER", "upper case"],
  ])("refuses %j, which is %s", (id) => {
    expect(() => budgetPath(paths, id)).toThrow(/unsafe budget id/iu);
    expect(() => backupDir(paths, id)).toThrow(/unsafe budget id/iu);
  });
});

describe("slopBudgetsFolder", () => {
  it("puts a pre-release budget beside the stable folder, never inside it", () => {
    const documents = "/home/me/Documents";

    expect(slopBudgetsFolder(documents)).toBe("/home/me/Documents/Suite Slop/Budget");
    expect(slopBudgetsFolder(documents)).not.toBe("/home/me/Documents/Suite/Budget");
  });
});

describe("pre-release link resolution", () => {
  it("cannot resolve the stable default from the pre-release folder", () => {
    const stable = "/home/me/Documents/Suite/Budget";
    const slop = slopBudgetsFolder("/home/me/Documents");
    const present = (path: string) => path.startsWith(stable);

    expect(budgetFromLink("suite://budget/workspace/2026.budget", slop, present)).toBeNull();
    expect(
      budgetFromArgv(["suite-budget", "suite://budget/workspace/2026.budget"], slop, present),
    ).toBe(null);
  });

  it("still resolves a budget in its own folder", () => {
    const slop = slopBudgetsFolder("/home/me/Documents");
    const present = (path: string) => path.startsWith(slop);

    expect(budgetFromLink("suite://budget/workspace/2026.budget", slop, present)).toBe(
      "/home/me/Documents/Suite Slop/Budget/2026.budget",
    );
  });
});

describe("budgetFromLink", () => {
  const folder = "/home/me/Documents/Suite/Budget";
  const present = () => true;

  it("resolves a link to the named budget in the library", () => {
    expect(budgetFromLink("suite://budget/workspace/2026.budget", folder, present)).toBe(
      `${folder}/2026.budget`,
    );
  });

  it("refuses a file that is not there", () => {
    expect(budgetFromLink("suite://budget/workspace/moved.budget", folder, () => false)).toBe(null);
  });

  it("refuses a name that is not a budget", () => {
    expect(budgetFromLink("suite://budget/workspace/notes.txt", folder, present)).toBeNull();
    expect(budgetFromLink("suite://budget/workspace/a/b.budget", folder, present)).toBeNull();
  });

  it("refuses a link that names another app", () => {
    expect(budgetFromLink("suite://planner/workspace/x.planner", folder, present)).toBeNull();
  });

  it("refuses a path, which is the other spelling it accepts", () => {
    expect(budgetFromLink("/tmp/x.budget", folder, present)).toBeNull();
  });
});

describe("budgetFromArgv", () => {
  const folder = "/home/me/Documents/Suite/Budget";
  const present = () => true;
  const argv = (...args: string[]) => ["/usr/bin/suite-budget", ...args];

  it("reads a path the desktop handed over", () => {
    expect(budgetFromArgv(argv("/tmp/x.budget"), folder, present)).toBe("/tmp/x.budget");
  });

  it("reads a link the hub routed here", () => {
    expect(budgetFromArgv(argv("suite://budget/workspace/2026.budget"), folder, present)).toBe(
      `${folder}/2026.budget`,
    );
  });

  it("never treats a link as a path", () => {
    // A link ends in `.budget` too, so the order of the two tests is the rule.
    expect(budgetFromArgv(argv("suite://budget/workspace/gone.budget"), folder, () => false)).toBe(
      null,
    );
  });
});
