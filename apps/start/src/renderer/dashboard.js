import { el, relativeTime } from "./format.js";

/**
 * The dashboard: one shell per widget, in the order the layout file names them.
 *
 * The page decides placement and nothing else. Which widgets exist, what each is called,
 * which size classes it offers and why an entry was dropped all arrive in
 * `state.dashboard`; the same rule as the rest of this directory.
 *
 * Reordering is a move control rather than drag-only: two buttons and a size picker per
 * widget are reachable by pointer and by keyboard, name the widget they act on, and do not
 * ask a person to hold a button while aiming. The app grid is ordinary content inside the
 * `start.apps` shell, so the existing cards, installs and launches are untouched.
 */

/** What the last control a person used was, so a re-render can put focus back on it. */
let lastControl = null;

const STATUS_IDLE = "";

function moveButton(widget, direction, index, total, disabled) {
  const label = direction === "earlier" ? "Move earlier" : "Move later";
  const button = el("button", `button quiet widget-move widget-${direction}`, label);
  button.type = "button";
  button.dataset.widgetAction = direction;
  button.disabled = disabled;
  button.setAttribute("aria-label", `${label}: ${widget.title}, position ${index + 1} of ${total}`);
  button.addEventListener("click", () => {
    lastControl = { widgetId: widget.id, action: direction, kind: "widget" };
    const position = direction === "earlier" ? index : index + 2;
    announce(`Moved ${widget.title} to position ${position} of ${total}.`);
    widget.actions.moveWidget(widget.id, direction);
  });
  return button;
}

function sizePicker(widget) {
  const label = el("label", "widget-size");
  label.append(el("span", "widget-size-label", "Size"));
  const select = el("select", "widget-size-select");
  select.dataset.widgetAction = "size";
  select.setAttribute("aria-label", `Size of ${widget.title}`);
  for (const size of widget.sizes) {
    const option = el("option", null, size === "full" ? "Full width" : size);
    option.value = size;
    option.selected = size === widget.size;
    select.append(option);
  }
  select.addEventListener("change", () => {
    lastControl = { widgetId: widget.id, action: "size", kind: "widget" };
    widget.actions.resizeWidget(widget.id, select.value);
  });
  label.append(select);
  return label;
}

function removeButton(widget, total) {
  const button = el("button", "button quiet widget-remove", "Remove");
  button.type = "button";
  button.dataset.widgetAction = "remove";
  // The last widget stays: an empty dashboard is a blank window with no way back.
  button.disabled = total <= 1;
  button.setAttribute("aria-label", `Remove ${widget.title} from the dashboard`);
  button.addEventListener("click", () => {
    lastControl = { widgetId: widget.id, action: "add", kind: "add" };
    widget.actions.removeWidget(widget.id);
    announce(`${widget.title} was removed from the dashboard.`);
  });
  return button;
}

function widgetTools(widget, index, total) {
  const tools = el("div", "widget-tools");
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", `${widget.title} widget`);
  tools.append(
    moveButton(widget, "earlier", index, total, index === 0),
    moveButton(widget, "later", index, total, index === total - 1),
    sizePicker(widget),
    removeButton(widget, total),
  );
  return tools;
}

/** The app grid: the same lists `renderApps` fills, so every card behaves as before. */
function appsBody() {
  const body = el("div", "widget-body");
  const apps = el("ul", "cards");
  apps.id = "apps";
  body.append(apps);

  const empty = el(
    "p",
    "empty",
    "Nothing to show yet. Use Add app… to pick an application's executable.",
  );
  empty.id = "apps-empty";
  empty.hidden = true;

  const section = el("section", "app-section");
  section.id = "apps-pre-release";
  section.hidden = true;
  const heading = el("h3", null, "Pre-release");
  heading.id = "apps-pre-release-title";
  section.append(
    heading,
    el(
      "p",
      "section-note",
      "Pre-release builds may be broken, incomplete, or change shape without notice. Each app has one pre-release install shared by the slop, canary and beta tiers: switching tiers keeps that install and changes its data folder. Pre-release documents live in Suite Slop, separate from stable, and uninstalling asks before deleting them.",
    ),
  );
  const list = el("ul", "cards");
  list.id = "apps-pre-release-list";
  section.append(list);

  body.append(empty, section);
  return body;
}

function recentsBody(state, actions) {
  const body = el("div", "widget-body");
  if (state.recents.length === 0) {
    body.append(el("p", "empty", "Nothing opened from Start yet."));
    return body;
  }

  const list = el("ul", "rows widget-recents");
  for (const entry of state.recents) {
    const row = el("li", "row");
    const open = el("button", "row-open");
    open.type = "button";
    open.append(
      el("span", "row-name", entry.name),
      el("span", "row-meta", `${entry.appName} · ${relativeTime(entry.openedAt)}`),
    );
    open.addEventListener("click", () => actions.openRecent(entry));
    row.append(open);
    list.append(row);
  }
  body.append(list);
  return body;
}

function widgetShell(widget, state, actions, index, total) {
  const node = el("li", "widget");
  node.dataset.widgetId = widget.id;
  node.dataset.size = widget.size;

  const head = el("div", "widget-head");
  const heading = el("div", "widget-heading");
  heading.append(
    el("h3", "widget-title", widget.title),
    el("p", "widget-note", widget.description),
  );
  head.append(heading, widgetTools({ ...widget, actions }, index, total));
  node.append(head);

  if (widget.kind === "apps") node.append(appsBody());
  else node.append(recentsBody(state, actions));

  return node;
}

function announce(message) {
  const status = document.getElementById("dashboard-status");
  if (status) status.textContent = message;
}

/** Put focus back on the control a person just used, if the redraw kept it. */
function restoreFocus() {
  if (lastControl === null) return;
  if (lastControl.kind === "add") {
    document.getElementById("widget-picker")?.focus?.();
    lastControl = null;
    return;
  }
  const shell = document.querySelector?.(`[data-widget-id="${lastControl.widgetId}"]`);
  if (!shell) {
    lastControl = null;
    return;
  }
  const selector = `[data-widget-action="${lastControl.action}"]`;
  const control = shell.querySelector?.(selector);
  // A disabled control cannot take focus: the widget is now at the end it moved to, so
  // focus the other move button rather than dropping it back to the top of the page.
  if (control && control.disabled !== true) control.focus?.();
  else shell.querySelector?.("[data-widget-action]")?.focus?.();
  lastControl = null;
}

function fillPicker(available) {
  const picker = document.getElementById("widget-picker");
  const holder = document.getElementById("dashboard-add");
  if (!picker || !holder) return;
  picker.replaceChildren();
  holder.hidden = available.length === 0;
  for (const widget of available) {
    const option = el("option", null, widget.title);
    option.value = widget.id;
    picker.append(option);
  }
}

/**
 * Draw the dashboard.
 *
 * `renderApps` runs after this, because the app grid's lists exist only once the widget
 * shell does. That keeps one renderer for the cards instead of two that drift.
 */
export function renderDashboard(state, actions) {
  const root = document.getElementById("dashboard");
  const note = document.getElementById("dashboard-note");
  if (!root || !note) return;

  const dashboard = state.dashboard;
  note.textContent = dashboard.note ?? "";
  note.hidden = dashboard.note === null;
  root.replaceChildren();

  const list = el("ul", "widgets");
  for (const [index, widget] of dashboard.widgets.entries()) {
    list.append(widgetShell(widget, state, actions, index, dashboard.widgets.length));
  }
  root.append(list);
  fillPicker(dashboard.available);

  if (lastControl === null) {
    // A fresh paint is a fresh announcement; the last move is no longer the news.
    const status = document.getElementById("dashboard-status");
    if (status) status.textContent = STATUS_IDLE;
  }
  restoreFocus();
}
