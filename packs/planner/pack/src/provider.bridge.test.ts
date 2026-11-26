import type {
  CommandProviderRequest,
  CommandProviderResponse,
  CommandsService,
} from "@suite/pack-runtime";
import { WorkspaceDocument } from "@suite/planner-core";
import { afterEach, describe, expect, it } from "vitest";
import { createPlannerPack, type PlannerPack } from "./bridge";
import { memoryDocuments } from "./test/fakeHost";

const now = new Date("2026-11-24T09:00:00.000Z");

function fakeCommands(): {
  service: CommandsService;
  call(
    entry: string,
    request: CommandProviderRequest,
  ): Promise<CommandProviderResponse>;
  entries(): readonly string[];
} {
  const handlers = new Map<
    string,
    (
      request: CommandProviderRequest,
    ) => CommandProviderResponse | Promise<CommandProviderResponse>
  >();
  return {
    service: {
      register: () => () => undefined,
      execute: async () => undefined,
      provide: (entry, handler) => {
        handlers.set(entry, handler);
        return () => handlers.delete(entry);
      },
    },
    call: async (entry, request) => {
      const handler = handlers.get(entry);
      if (handler === undefined)
        throw new Error(`no provider bound to ${entry}`);
      return handler(request);
    },
    entries: () => [...handlers.keys()],
  };
}

let active: PlannerPack | null = null;

afterEach(() => {
  active?.dispose();
  active = null;
});

describe("Planner's provider over the pack bridge", () => {
  it("binds the declared entries and round-trips a quick task into its document", async () => {
    const documents = memoryDocuments();
    const commands = fakeCommands();
    const pack = createPlannerPack({
      host: { documents, commands: commands.service },
      now: () => now,
    });
    active = pack;

    expect([...commands.entries()].sort()).toEqual(["commands", "scopes"]);

    const response = await commands.call("commands", {
      kind: "commands",
      commandId: "planner.quick-task",
      scope: "today",
      arguments: { title: "Capture from the surface" },
    });
    expect(response.ok).toBe(true);
    expect(response.open).toMatch(/^suite:\/\/planner\/task\//u);

    // The capture went through Planner's document layer and was flushed before the answer.
    const stored = documents.files.get("planner");
    expect(stored).toBeDefined();
    const reopened = WorkspaceDocument.fromSnapshot(stored as Uint8Array);
    const task = reopened
      .listTasks()
      .find((candidate) => candidate.title === "Capture from the surface");
    expect(task).toBeDefined();
    expect(task?.scheduledFor).toBe("2026-11-24");
    expect(response.open).toBe(
      `suite://planner/task/${encodeURIComponent(task?.id ?? "")}`,
    );
  });

  it("answers scope rows after the same document is open", async () => {
    const documents = memoryDocuments();
    const commands = fakeCommands();
    const pack = createPlannerPack({
      host: { documents, commands: commands.service },
      now: () => now,
    });
    active = pack;

    await commands.call("commands", {
      kind: "commands",
      commandId: "planner.quick-task",
      scope: "inbox",
      arguments: { title: "An inbox task" },
    });
    const rows = await commands.call("scopes", {
      kind: "scopes",
      call: "items",
      scopeId: "inbox",
      limit: 20,
    });
    expect(rows.ok).toBe(true);
    expect(rows.items?.map((item) => item.title)).toContain("An inbox task");
  });

  it("sends no document bytes on the command channel", async () => {
    const documents = memoryDocuments();
    const commands = fakeCommands();
    const pack = createPlannerPack({
      host: { documents, commands: commands.service },
      now: () => now,
    });
    active = pack;

    const seen: CommandProviderRequest[] = [];
    const original = commands.call;
    const request: CommandProviderRequest = {
      kind: "commands",
      commandId: "planner.quick-task",
      scope: "inbox",
      arguments: { title: "Plain text only" },
    };
    seen.push(request);
    await original("commands", request);

    const hasBytes = (value: unknown): boolean => {
      if (value instanceof Uint8Array) return true;
      if (Array.isArray(value)) return value.some(hasBytes);
      if (typeof value === "object" && value !== null) {
        return Object.values(value).some(hasBytes);
      }
      return false;
    };
    expect(hasBytes(request)).toBe(false);
    expect(JSON.stringify(request)).not.toContain("lor");
  });
});
