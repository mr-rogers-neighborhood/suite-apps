import type {
  CommandProviderRequest,
  CommandProviderResponse,
  PackProviderContribution,
} from "@suite/contracts/commands";
import { describe, expect, it, vi } from "vitest";
import { CommandBroker, type CommandProviderSender } from "./commandBroker";
import { CommandRecency } from "./commandSurface";
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
          keywords: ["task"],
          scope: "global",
          provider: "commands",
        },
      ],
      providers,
    },
    ...overrides,
  };
}

const sender: CommandProviderSender = { packId: "planner", webContentsId: 7 };

interface ChannelRecord {
  readonly sender: CommandProviderSender;
  readonly entry: string;
  readonly request: CommandProviderRequest;
}

function broker(
  options: {
    pack?: PackInfo;
    open?: boolean;
    consent?: boolean;
    response?: CommandProviderResponse | unknown;
    hostRun?: () => Promise<{ ok: boolean; message: string }>;
  } = {},
) {
  const calls: ChannelRecord[] = [];
  let open = options.open ?? true;
  const recency = new CommandRecency();
  const current = options.pack ?? pack();
  const instance = new CommandBroker({
    packs: () => [current],
    hostCommands: [
      {
        id: "desk.open-home",
        title: "Open Home",
        keywords: ["home"],
        run: options.hostRun ?? (async () => ({ ok: true, message: "Opened Home." })),
      },
    ],
    findSender: () => (open ? sender : null),
    ensureConsent: async () => options.consent ?? true,
    channel: {
      invoke: async (from, entry, request) => {
        calls.push({ sender: from, entry, request });
        return options.response ?? { ok: true, message: "Ran.", open: "suite://planner/task/1" };
      },
    },
    recency,
    now: () => 5_000,
  });
  return {
    instance,
    calls,
    recency,
    setOpen(value: boolean) {
      open = value;
    },
  };
}

describe("Command Surface invocation", () => {
  it("sends commandId, scope and string arguments over the scoped channel", async () => {
    const { instance, calls, recency } = broker();
    const outcome = await instance.invoke("planner.quick-task", "global", { title: "Buy milk" });

    expect(outcome).toEqual({ ok: true, message: "Ran.", open: "suite://planner/task/1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.entry).toBe("commands");
    expect(calls[0]?.request).toEqual({
      kind: "commands",
      commandId: "planner.quick-task",
      scope: "global",
      arguments: { title: "Buy milk" },
    });
    // No document bytes, path or handle on the channel.
    expect(calls[0]?.request).not.toHaveProperty("bytes");
    expect(calls[0]?.request).not.toHaveProperty("path");
    expect(JSON.stringify(calls[0]?.request)).not.toContain("loro");
    expect(recency.order()).toEqual(["planner.quick-task"]);
  });

  it("runs a host command without calling a pack", async () => {
    const { instance, calls } = broker();
    expect(await instance.invoke("desk.open-home", "global", {})).toEqual({
      ok: true,
      message: "Opened Home.",
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a pack without the commands capability", async () => {
    const { instance, calls } = broker({ pack: pack({ capabilities: ["documents"] }) });
    const outcome = await instance.invoke("planner.quick-task", "global", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("commands capability");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the person denied the commands capability", async () => {
    const { instance, calls } = broker({ consent: false });
    const outcome = await instance.invoke("planner.quick-task", "global", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("commands are off");
    expect(calls).toHaveLength(0);
  });

  it("refuses an undeclared provider instead of calling it", async () => {
    const rogue = pack({
      contributions: {
        commands: [{ id: "planner.rogue", title: "Rogue", provider: "nope", scope: "global" }],
        providers: [{ kind: "commands", entry: "commands", scopes: ["global"] }],
      },
    });
    const { instance, calls } = broker({ pack: rogue });
    const outcome = await instance.invoke("planner.rogue", "global", {});
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses non-string arguments before they cross the channel", async () => {
    const { instance, calls } = broker();
    const outcome = await instance.invoke("planner.quick-task", "global", {
      title: new Uint8Array([1, 2, 3]),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("record of strings");
    expect(calls).toHaveLength(0);
  });

  it("asks the person to open a closed pack", async () => {
    const { instance, calls } = broker({ open: false });
    const outcome = await instance.invoke("planner.quick-task", "global", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("Open Suite Planner to run Quick task.");
    expect(calls).toHaveLength(0);
  });

  it("refuses a malformed provider answer", async () => {
    const { instance } = broker({ response: { ok: "yes" } });
    const outcome = await instance.invoke("planner.quick-task", "global", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("answered with");
  });

  it("does not accept a non-suite link as an open target", async () => {
    const { instance } = broker({
      response: { ok: true, message: "Ran.", open: "https://example.com/evil" },
    });
    const outcome = await instance.invoke("planner.quick-task", "global", {});
    expect(outcome).toEqual({ ok: true, message: "Ran." });
  });

  it("clears the local recents list", async () => {
    const { instance, recency } = broker();
    await instance.invoke("planner.quick-task", "global", {});
    expect(recency.order()).toHaveLength(1);
    instance.clearRecents();
    expect(instance.listing("").recent).toEqual([]);
  });
});

describe("Command Surface scopes", () => {
  it("returns declared scopes from a closed pack", async () => {
    const { instance } = broker({ open: false });
    const view = await instance.scopes("planner");
    expect(view.ok).toBe(true);
    expect(view.scopes.map((scope) => scope.id)).toEqual(["inbox", "today"]);
  });

  it("names an unknown app as a placeholder", async () => {
    const { instance } = broker();
    const view = await instance.scopes("missing");
    expect(view.placeholder).toBe(true);
    expect(view.scopes[0]?.title).toContain("not installed");
  });

  it("caches display rows and leaves an age with 'Open app to refresh'", async () => {
    const response: CommandProviderResponse = {
      ok: true,
      items: [{ id: "task-1", title: "Plan the day" }],
    };
    const { instance, setOpen } = broker({ response });
    const live = await instance.items("planner", "today", 20);
    expect(live.ageMs).toBe(0);
    expect(live.items[0]?.title).toBe("Plan the day");

    setOpen(false);
    const stale = await instance.items("planner", "today", 20);
    expect(stale.stale).toBe(true);
    expect(stale.ageMs).toBe(0);
    expect(stale.items[0]?.title).toBe("Plan the day");
    expect(stale.message).toBe("Open Suite Planner to refresh.");
  });

  it("leaves a named placeholder when a closed pack has no cached rows", async () => {
    const { instance } = broker({ open: false });
    const view = await instance.items("planner", "inbox", 20);
    expect(view.placeholder).toBe(true);
    expect(view.items[0]?.title).toBe("Open the app to load this scope");
  });

  it("refuses a scope the pack does not declare", async () => {
    const { instance } = broker();
    const view = await instance.items("planner", "someday", 20);
    expect(view.ok).toBe(false);
    expect(view.message).toContain("does not declare");
  });

  it("captures through the scope provider and invalidates the cached rows", async () => {
    const { instance, calls } = broker();
    await instance.items("planner", "inbox", 20);
    const outcome = await instance.capture("planner", "inbox", { title: "New" });
    expect(outcome.ok).toBe(true);
    expect(calls.at(-1)?.request).toEqual({
      kind: "scopes",
      call: "capture",
      scopeId: "inbox",
      values: { title: "New" },
    });
  });

  it("refuses capture when consent is denied", async () => {
    const { instance, calls } = broker({ consent: false });
    const outcome = await instance.capture("planner", "inbox", { title: "New" });
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("Command Surface search", () => {
  it("aggregates opaque result ids and opens only suite links", async () => {
    const searchPack = pack({
      contributions: {
        commands: [],
        providers: [
          { kind: "search", entry: "search", scopes: ["global"] },
          { kind: "scopes", entry: "scopes", scopes: ["today"] },
        ],
      },
    });
    const calls: CommandProviderRequest[] = [];
    const instance = new CommandBroker({
      packs: () => [searchPack],
      hostCommands: [],
      findSender: () => sender,
      ensureConsent: async () => true,
      channel: {
        invoke: async (_from, _entry, request) => {
          calls.push(request);
          return {
            ok: true,
            results: [
              { id: "task-1", title: "Plan", open: "suite://planner/task/task-1" },
              { id: "bad", title: "Bad", open: "https://example.com" },
            ],
          };
        },
      },
    });

    const view = await instance.search("plan");
    expect(calls[0]).toEqual({
      kind: "search",
      query: "plan",
      scope: "global",
      limit: 20,
    });
    expect(view.hits).toEqual([
      {
        packId: "planner",
        packName: "Suite Planner",
        id: "task-1",
        title: "Plan",
        subtitle: "Suite Planner",
        open: "suite://planner/task/task-1",
      },
    ]);
  });

  it("does nothing for an empty query", async () => {
    const invoke = vi.fn();
    const instance = new CommandBroker({
      packs: () => [pack()],
      hostCommands: [],
      findSender: () => sender,
      ensureConsent: async () => true,
      channel: { invoke },
    });
    expect(await instance.search("  ")).toEqual({ ok: true, hits: [], message: null });
    expect(invoke).not.toHaveBeenCalled();
  });
});
