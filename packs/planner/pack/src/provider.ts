import type {
  CommandProviderRequest,
  CommandProviderResponse,
  CommandScope,
  CommandScopeItem,
} from "@suite/pack-runtime";
import {
  dayPlan,
  inboxTasks,
  parseCapture,
  type Task,
  todayKey,
  type WorkspaceDocument,
} from "@suite/planner-core";

/**
 * Planner's Command Surface provider (#225, #226).
 *
 * The manifest declares one commands entry and one scopes entry. These are the
 * two handlers the pack binds for them. A call receives a command id, a scope
 * and a record of strings; it answers with a sentence and, when the row has a
 * place to go, a `suite://` link. No document bytes cross the channel.
 *
 * The host never sees a task id, a project or a document; it sees the display
 * rows this module chooses to publish and then routes the link.
 */

export const PLANNER_COMMANDS_ENTRY = "commands";
export const PLANNER_SCOPES_ENTRY = "scopes";
export const PLANNER_PACK_ID = "planner";

export const QUICK_TASK_COMMAND = "planner.quick-task";
export const TODAY_COMMAND = "planner.today";
export const INBOX_COMMAND = "planner.inbox";

export const TODAY_SCOPE = "today";
export const INBOX_SCOPE = "inbox";

export interface PlannerProviderOptions {
  readonly now?: () => Date;
}

export function plannerTaskLink(taskId: string): string {
  return `suite://${PLANNER_PACK_ID}/task/${encodeURIComponent(taskId)}`;
}

export function plannerTodayLink(): string {
  return `suite://${PLANNER_PACK_ID}/today`;
}

export function plannerInboxLink(): string {
  return `suite://${PLANNER_PACK_ID}/inbox`;
}

/** The view a planner deep link names, for the renderer's one resolver. */
export function plannerDeepLinkView(url: string): "today" | "inbox" | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "suite:" ||
    parsed.hostname.toLowerCase() !== PLANNER_PACK_ID
  ) {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/u, "");
  if (path === "/today") return "today";
  if (path === "/inbox") return "inbox";
  return null;
}

function itemFor(task: Task, detail: string): CommandScopeItem {
  return {
    id: task.id,
    title: task.title.trim().length > 0 ? task.title.trim() : "Untitled task",
    subtitle: detail,
    ...(task.status === "done" ? { done: true } : {}),
  };
}

function projectNames(document: WorkspaceDocument): Map<string, string> {
  return new Map(
    document.listProjects().map((project) => [project.id, project.name]),
  );
}

export function todayItems(
  document: WorkspaceDocument,
  limit: number,
  now: Date,
): readonly CommandScopeItem[] {
  const plan = dayPlan(document.listTasks(), todayKey(now), {
    defaultEstimateMinutes: document.getSettings().defaultEstimateMinutes,
    includeCompleted: false,
  });
  const projects = projectNames(document);
  const rows: CommandScopeItem[] = [];
  for (const entry of plan.tasks) {
    const project =
      entry.task.projectId === null
        ? ""
        : (projects.get(entry.task.projectId) ?? "");
    rows.push(itemFor(entry.task, project));
  }
  for (const task of plan.overdue) {
    if (rows.length >= limit) break;
    const project =
      task.projectId === null ? "" : (projects.get(task.projectId) ?? "");
    rows.push(
      itemFor(task, project.length === 0 ? "Overdue" : `Overdue · ${project}`),
    );
  }
  return rows.slice(0, limit);
}

export function inboxItems(
  document: WorkspaceDocument,
  limit: number,
): readonly CommandScopeItem[] {
  const projects = projectNames(document);
  return inboxTasks(document.listTasks())
    .slice(0, limit)
    .map((task) => {
      const project =
        task.projectId === null ? "" : (projects.get(task.projectId) ?? "");
      return itemFor(task, project.length === 0 ? "Inbox" : project);
    });
}

export function plannerScopes(): readonly CommandScope[] {
  return [
    { id: TODAY_SCOPE, title: "Today", subtitle: "Planner" },
    { id: INBOX_SCOPE, title: "Inbox", subtitle: "Planner" },
  ];
}

/**
 * Capture one line into the planner document.
 *
 * The tokens Planner already understands (`today`, `tomorrow`, `friday`,
 * `#project`, `@tag`, `!1`, `~30m`) keep working, so the host's capture mode and
 * Planner's own capture bar share one grammar. The provider never invents a
 * second parser.
 */
export function captureTask(
  document: WorkspaceDocument,
  scopeId: string,
  values: Readonly<Record<string, string>>,
  now: Date,
): { readonly task: Task | null; readonly response: CommandProviderResponse } {
  const text = (values.title ?? values.text ?? values.capture ?? "").trim();
  if (text.length === 0) {
    return {
      task: null,
      response: { ok: false, message: "Type what to capture first." },
    };
  }
  const day = todayKey(now);
  const parsed = parseCapture(text, day, { impliedDate: day });
  const scheduledFor =
    scopeId === INBOX_SCOPE
      ? null
      : scopeId === TODAY_SCOPE
        ? (parsed.dateKey ?? day)
        : parsed.dateKey;

  try {
    const task = document.createTask(
      {
        title: parsed.title,
        scheduledFor,
        estimateMinutes: parsed.estimateMinutes,
        priority: parsed.priority,
        source: "command-surface",
      },
      now,
    );
    const where =
      scheduledFor === null
        ? "the inbox"
        : scheduledFor === day
          ? "Today"
          : scheduledFor;
    return {
      task,
      response: {
        ok: true,
        message: `Added “${task.title}” to ${where}.`,
        open: plannerTaskLink(task.id),
      },
    };
  } catch (error) {
    return {
      task: null,
      response: {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Planner could not add that task.",
      },
    };
  }
}

export function handlePlannerCommand(
  document: WorkspaceDocument,
  request: Extract<CommandProviderRequest, { kind: "commands" }>,
  options: PlannerProviderOptions = {},
): CommandProviderResponse {
  const now = (options.now ?? (() => new Date()))();
  if (request.commandId === QUICK_TASK_COMMAND) {
    return captureTask(document, request.scope, request.arguments, now)
      .response;
  }
  if (request.commandId === TODAY_COMMAND) {
    return { ok: true, message: "Opened Today.", open: plannerTodayLink() };
  }
  if (request.commandId === INBOX_COMMAND) {
    return { ok: true, message: "Opened Inbox.", open: plannerInboxLink() };
  }
  return {
    ok: false,
    message: `Planner does not answer the command ${request.commandId}.`,
  };
}

export function handlePlannerScope(
  document: WorkspaceDocument,
  request: Extract<CommandProviderRequest, { kind: "scopes" }>,
  options: PlannerProviderOptions = {},
): CommandProviderResponse {
  const now = (options.now ?? (() => new Date()))();
  if (request.call === "scopes") return { ok: true, scopes: plannerScopes() };

  const scopeId = request.scopeId;
  if (scopeId !== TODAY_SCOPE && scopeId !== INBOX_SCOPE) {
    return {
      ok: false,
      message: `Planner does not declare the ${scopeId} scope.`,
    };
  }

  if (request.call === "items") {
    const limit = request.limit ?? 20;
    return {
      ok: true,
      items:
        scopeId === TODAY_SCOPE
          ? todayItems(document, limit, now)
          : inboxItems(document, limit),
    };
  }

  if (request.call === "capture") {
    const { response } = captureTask(document, scopeId, request.values, now);
    return response;
  }

  if (request.itemId !== undefined) {
    const task = document.getTask(request.itemId);
    if (task === undefined) {
      return {
        ok: false,
        message: "That task is no longer in this workspace.",
      };
    }
    return {
      ok: true,
      message: `Opened “${task.title}”.`,
      open: plannerTaskLink(task.id),
    };
  }

  return {
    ok: true,
    message: scopeId === TODAY_SCOPE ? "Opened Today." : "Opened Inbox.",
    open: scopeId === TODAY_SCOPE ? plannerTodayLink() : plannerInboxLink(),
  };
}
