import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeOnboarding, isFirstRun } from "./onboarding.js";

const roots: string[] = [];

async function dataRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "suite-desk-onboarding-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("first run", () => {
  it("is a first run when the record is missing", async () => {
    expect(await isFirstRun(await dataRoot())).toBe(true);
  });

  it("stops being a first run after the record is completed", async () => {
    const root = await dataRoot();
    await completeOnboarding(root);
    expect(await isFirstRun(root)).toBe(false);
    const record = JSON.parse(await readFile(join(root, "onboarding.json"), "utf8")) as {
      version: number;
      completed: boolean;
      completedAt: string | null;
    };
    expect(record.version).toBe(1);
    expect(record.completed).toBe(true);
    expect(record.completedAt).not.toBeNull();
  });

  it("repeats for a record this build does not understand", async () => {
    const root = await dataRoot();
    await writeFile(join(root, "onboarding.json"), JSON.stringify({ version: 2, completed: true }));
    expect(await isFirstRun(root)).toBe(true);
  });

  it("repeats for a record that is not JSON", async () => {
    const root = await dataRoot();
    await writeFile(join(root, "onboarding.json"), "not json");
    expect(await isFirstRun(root)).toBe(true);
  });
});
