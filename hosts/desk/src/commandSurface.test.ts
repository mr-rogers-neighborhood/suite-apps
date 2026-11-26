import type { PackProviderContribution } from "@suite/contracts/commands";
import { describe, expect, it } from "vitest";
import {
  CommandRecency,
  commandApps,
  declaredScopes,
  discoverCommands,
  packCommandEntries,
  rankCommands,
  ScopeRowsCache,
  unknownScopePlaceholder,
} from "./commandSurface";
import type { PackInfo } from "./packs";

const providers: readonly PackProviderContribution[] = [
  { kind: "commands", entry: "commands", scopes: ["global"] },
  { kind: "scopes", entry: "scopes", scopes: ["today", "inbox"] },
];

function pack(overrides: Partial<PackInfo> = {}): PackInfo {
  return {
    id: "planner",
    name: "Suite Planner",
    version: "1.0.0",
    description: null,
    entry: "index.html",
    capabilities: ["commands"],
    source: "installed",
    publisher: null,
    root: "/tmp/planner",
    contributions: {
      commands: [
        {
          id: "planner.quick-task",
          title: "Quick task",
          subtitle: "Capture into Planner",
          keywords: ["task", "todo"],
          scope: "global",
          provider: "commands",
        },
        {
          id: "planner.today",
          title: "Open Today",
          keywords: ["today"],
          scope: "global",
          provider: "commands",
        },
        {
          id: "planner.inbox",
          title: "Open Inbox",
          keywords: ["inbox"],
          scope: "global",
          provider: "commands",
        },
      ],
      providers,
    },
    ...overrides,
  };
}

const hostCommands = [
  {
    id: "desk.open-home",
    title: "Open Home",
    keywords: ["home"],
    run: async () => ({ ok: true, message: "Opened Home." }),
  },
];

describe("Command Surface discovery", () => {
  it("lists host commands and commands from a pack that declares the capability", () => {
    const entries = discoverCommands([pack()], hostCommands);
    expect(entries.map((entry) => entry.id)).toEqual([
      "desk.open-home",
      "planner.quick-task",
      "planner.today",
      "planner.inbox",
    ]);
    expect(entries[0]?.source).toBe("host");
    expect(entries[1]?.packId).toBe("planner");
    expect(entries[1]?.provider).toBe("commands");
  });

  it("hides a pack's commands without the commands capability", () => {
    expect(packCommandEntries(pack({ capabilities: ["documents"] }))).toEqual([]);
    expect(discoverCommands([pack({ capabilities: [] })], hostCommands)).toHaveLength(1);
  });

  it("refuses a command whose provider is not declared by leaving it out", () => {
    const undeclared = pack({
      contributions: {
        commands: [
          { id: "planner.rogue", title: "Rogue", provider: "not-declared", scope: "global" },
        ],
        providers: [{ kind: "commands", entry: "commands", scopes: ["global"] }],
      },
    });
    expect(packCommandEntries(undeclared)).toEqual([]);
  });

  it("uses the first commands provider when a command does not name one", () => {
    const implicit = pack({
      contributions: {
        commands: [{ id: "planner.today", title: "Open Today", scope: "global" }],
        providers: [{ kind: "commands", entry: "commands", scopes: ["global"] }],
      },
    });
    expect(packCommandEntries(implicit)[0]?.provider).toBe("commands");
  });

  it("lists the apps and the scopes their manifests declare", () => {
    expect(declaredScopes(pack())).toEqual(["inbox", "today"]);
    expect(commandApps([pack()])).toEqual([
      { id: null, name: "Suite Desk", scopes: [] },
      { id: "planner", name: "Suite Planner", scopes: ["inbox", "today"] },
    ]);
  });
});

describe("deterministic ranking", () => {
  const entries = discoverCommands([pack()], hostCommands);

  it("orders exact, then prefix, then keyword, then title", () => {
    expect(rankCommands(entries, "Open Today").map((entry) => entry.id)).toEqual(["planner.today"]);
    expect(rankCommands(entries, "Open").map((entry) => entry.id)).toEqual([
      "desk.open-home",
      "planner.inbox",
      "planner.today",
    ]);
    expect(rankCommands(entries, "todo").map((entry) => entry.id)).toEqual(["planner.quick-task"]);
  });

  it("uses local recency to break a title tie, then title order", () => {
    const tied = [
      ...entries,
      {
        id: "planner.quick-add",
        title: "Quick task",
        subtitle: null,
        keywords: [],
        scope: "global",
        source: "pack" as const,
        packId: "planner",
        packName: "Suite Planner",
        provider: "commands",
        icon: null,
      },
    ];
    expect(rankCommands(tied, "quick task").map((entry) => entry.id)).toEqual([
      "planner.quick-add",
      "planner.quick-task",
    ]);
    expect(
      rankCommands(tied, "quick task", ["planner.quick-task"]).map((entry) => entry.id),
    ).toEqual(["planner.quick-task", "planner.quick-add"]);
  });

  it("uses recency, then title, for an empty query", () => {
    expect(rankCommands(entries, "").map((entry) => entry.id)).toEqual([
      "desk.open-home",
      "planner.inbox",
      "planner.today",
      "planner.quick-task",
    ]);
    expect(rankCommands(entries, "", ["planner.inbox"]).map((entry) => entry.id)[0]).toBe(
      "planner.inbox",
    );
  });

  it("keeps recency local and clearable", () => {
    const recency = new CommandRecency(2);
    recency.touch("planner.today");
    recency.touch("planner.inbox");
    recency.touch("planner.today");
    expect(recency.order()).toEqual(["planner.today", "planner.inbox"]);
    recency.clear();
    expect(recency.order()).toEqual([]);
  });
});

describe("scope row cache and placeholders", () => {
  it("keeps display rows and an age, and clears them", () => {
    let now = 1_000;
    const cache = new ScopeRowsCache();
    cache.set("planner", "today", [{ id: "task-1", title: "Plan" }], now);
    now = 5_000;
    expect(cache.get("planner", "today")).toEqual({
      items: [{ id: "task-1", title: "Plan" }],
      fetchedAt: 1_000,
    });
    cache.forget("planner", "today");
    expect(cache.get("planner", "today")).toBeNull();
  });

  it("names an unknown app or scope instead of hiding it", () => {
    expect(unknownScopePlaceholder("missing").title).toContain("not installed");
    expect(unknownScopePlaceholder("planner", "someday").subtitle).toContain("does not declare");
  });
});
