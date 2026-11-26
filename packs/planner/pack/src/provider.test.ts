import { SCHEMA_VERSION, WorkspaceDocument } from "@suite/planner-core";
import { describe, expect, it } from "vitest";
import {
  captureTask,
  handlePlannerCommand,
  handlePlannerScope,
  INBOX_SCOPE,
  inboxItems,
  plannerDeepLinkView,
  plannerInboxLink,
  plannerTaskLink,
  plannerTodayLink,
  TODAY_SCOPE,
  todayItems,
} from "./provider";

const now = new Date("2026-11-24T09:00:00.000Z");

function documentWithInboxTask(title = "Buy milk"): WorkspaceDocument {
  const doc = WorkspaceDocument.create({ now });
  doc.createTask({ title }, now);
  return doc;
}

describe("Planner's Command Surface provider", () => {
  it("captures a quick task into the inbox through the planner's own parser", () => {
    const doc = WorkspaceDocument.create({ now });
    const { task, response } = captureTask(
      doc,
      INBOX_SCOPE,
      { title: "Write the pack tomorrow" },
      now,
    );

    expect(response.ok).toBe(true);
    expect(response.message).toContain("Write the pack");
    expect(task?.title).toBe("Write the pack");
    expect(task?.scheduledFor).toBeNull();
    expect(response.open).toBe(plannerTaskLink(task?.id ?? ""));
    expect(doc.getSnapshot().meta.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("captures into Today when the scope asks for it", () => {
    const doc = WorkspaceDocument.create({ now });
    const { task } = captureTask(
      doc,
      TODAY_SCOPE,
      { title: "Plan the day" },
      now,
    );
    expect(task?.scheduledFor).toBe("2026-11-24");
    expect(task?.status).toBe("planned");
  });

  it("refuses an empty capture with a sentence, not a task", () => {
    const doc = WorkspaceDocument.create({ now });
    const before = doc.listTasks().length;
    const { task, response } = captureTask(
      doc,
      INBOX_SCOPE,
      { title: "   " },
      now,
    );
    expect(task).toBeNull();
    expect(response.ok).toBe(false);
    expect(doc.listTasks()).toHaveLength(before);
  });

  it("answers the three commands and refuses an undeclared one", () => {
    const doc = documentWithInboxTask();
    expect(
      handlePlannerCommand(
        doc,
        {
          kind: "commands",
          commandId: "planner.today",
          scope: "global",
          arguments: {},
        },
        { now: () => now },
      ).open,
    ).toBe(plannerTodayLink());
    expect(
      handlePlannerCommand(
        doc,
        {
          kind: "commands",
          commandId: "planner.inbox",
          scope: "global",
          arguments: {},
        },
        { now: () => now },
      ).open,
    ).toBe(plannerInboxLink());
    const unknown = handlePlannerCommand(
      doc,
      {
        kind: "commands",
        commandId: "planner.delete-everything",
        scope: "global",
        arguments: {},
      },
      { now: () => now },
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toContain("does not answer");
  });

  it("lists today and inbox rows with ids and display metadata only", () => {
    const doc = documentWithInboxTask("Buy milk");
    const plan = doc.createTask(
      { title: "Plan the day", scheduledFor: "2026-11-24" },
      now,
    );

    const today = handlePlannerScope(
      doc,
      { kind: "scopes", call: "items", scopeId: TODAY_SCOPE, limit: 20 },
      { now: () => now },
    );
    expect(today.ok).toBe(true);
    expect(today.items?.map((item) => item.id)).toContain(plan.id);

    const inbox = handlePlannerScope(
      doc,
      { kind: "scopes", call: "items", scopeId: INBOX_SCOPE, limit: 20 },
      { now: () => now },
    );
    expect(inbox.items?.[0]?.title).toBe("Buy milk");
    expect(inbox.items?.[0]).not.toHaveProperty("bytes");
  });

  it("opens a task by id and the whole scope without one", () => {
    const doc = documentWithInboxTask();
    const task = doc.listTasks()[0];
    if (task === undefined) throw new Error("expected an inbox task");
    const opened = handlePlannerScope(
      doc,
      { kind: "scopes", call: "open", scopeId: INBOX_SCOPE, itemId: task.id },
      { now: () => now },
    );
    expect(opened.open).toBe(plannerTaskLink(task.id));

    const whole = handlePlannerScope(
      doc,
      { kind: "scopes", call: "open", scopeId: TODAY_SCOPE },
      { now: () => now },
    );
    expect(whole.open).toBe(plannerTodayLink());
  });

  it("returns the declared scopes and refuses an unknown one", () => {
    const doc = WorkspaceDocument.create({ now });
    const scopes = handlePlannerScope(
      doc,
      { kind: "scopes", call: "scopes" },
      { now: () => now },
    );
    expect(scopes.scopes?.map((scope) => scope.id)).toEqual(["today", "inbox"]);

    const unknown = handlePlannerScope(
      doc,
      { kind: "scopes", call: "items", scopeId: "someday" },
      { now: () => now },
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toContain("does not declare");
  });

  it("resolves the today and inbox deep links", () => {
    expect(plannerDeepLinkView(plannerTodayLink())).toBe("today");
    expect(plannerDeepLinkView(plannerInboxLink())).toBe("inbox");
    expect(plannerDeepLinkView("suite://planner/task/abc")).toBeNull();
    expect(plannerDeepLinkView("https://planner/today")).toBeNull();
  });

  it("keeps scope rows display metadata, never a document payload", () => {
    const doc = documentWithInboxTask();
    const items = [...todayItems(doc, 20, now), ...inboxItems(doc, 20)];
    for (const item of items) {
      expect(
        Object.values(item).every((value) => typeof value !== "object"),
      ).toBe(true);
    }
  });
});
