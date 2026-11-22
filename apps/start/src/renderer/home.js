import { el, relativeTime } from "./format.js";

/**
 * The Home Screen: one shell per placement, in the Screen's own order.
 *
 * The page decides placement and nothing else. Which widgets exist, what each is called,
 * which size classes it offers, which settings and capture fields it declares and why a
 * placement is unknown all arrive in `state.screens`; the same rule as the rest of this
 * directory.
 *
 * Inline edit is a mode, not a drag gesture. Every edit is a named button or a picker, so
 * it is reachable by pointer and by keyboard, and a focused placement answers Alt+Left and
 * Alt+Right with a move. The app grid is ordinary content inside the `start.apps` shell, so
 * the existing cards, installs and launches are untouched.
 */

/** What the last control a person used was, so a re-render can put focus back on it. */
let lastControl = null;

/** Whether the inline editing tools are showing. UI state, never document state. */
let editing = false;

const STATUS_IDLE = "";

function moveButton(widget, direction, index, total, disabled, actions) {
  const label = direction === "earlier" ? "Move earlier" : "Move later";
  const button = el("button", `button quiet widget-move widget-${direction}`, label);
  button.type = "button";
  button.dataset.widgetAction = direction;
  button.disabled = disabled;
  button.setAttribute("aria-label", `${label}: ${widget.title}, position ${index + 1} of ${total}`);
  button.addEventListener("click", () => {
    lastControl = { widgetId: widget.registryId, action: direction };
    const position = direction === "earlier" ? index : index + 2;
    announce(`Moved ${widget.title} to position ${position} of ${total}.`);
    actions.moveWidget(widget.registryId, direction);
  });
  return button;
}

function sizePicker(widget, actions) {
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
    lastControl = { widgetId: widget.registryId, action: "size" };
    actions.resizeWidget(widget.registryId, select.value);
  });
  label.append(select);
  return label;
}

function removeButton(widget, total, actions) {
  const button = el("button", "button quiet widget-remove", "Remove");
  button.type = "button";
  button.dataset.widgetAction = "remove";
  // The last placement stays: an empty Home is a blank window with no way back.
  button.disabled = total <= 1;
  button.setAttribute("aria-label", `Remove ${widget.title} from this Screen`);
  button.addEventListener("click", () => {
    lastControl = { kind: "add" };
    actions.removeWidget(widget.registryId);
    announce(`${widget.title} was removed from this Screen.`);
  });
  return button;
}

function widgetTools(widget, index, total, actions) {
  const tools = el("div", "widget-tools");
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", `${widget.title} widget`);
  tools.append(
    moveButton(widget, "earlier", index, total, index === 0, actions),
    moveButton(widget, "later", index, total, index === total - 1, actions),
    sizePicker(widget, actions),
    removeButton(widget, total, actions),
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

function inputType(type) {
  if (type === "day") return "date";
  if (type === "number") return "number";
  return "text";
}

/** The capture fields an app declared. This build draws them but has no app to send to. */
function captureForm(widget) {
  const form = el("form", "widget-capture");
  form.setAttribute("aria-label", `${widget.title} capture`);
  form.addEventListener("submit", (event) => event.preventDefault?.());

  for (const field of widget.fields) {
    const label = el("label", "widget-field");
    label.append(el("span", "widget-field-label", field.label));
    const input = el("input", "field");
    input.type = inputType(field.type);
    input.name = field.id;
    input.value = "";
    input.required = field.required;
    if (field.maxLength !== null) input.maxLength = field.maxLength;
    label.append(input);
    form.append(label);
  }

  const submit = el("button", "button", widget.submitLabel ?? "Save");
  submit.type = "submit";
  submit.disabled = true;
  submit.setAttribute("aria-label", `${widget.submitLabel ?? "Save"} ${widget.title}`);
  form.append(submit);
  return form;
}

/** Instance settings belong to the placement, so they are saved on the Screen. */
function settingsEditor(widget, actions) {
  const group = el("div", "widget-settings");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `${widget.title} settings`);
  for (const setting of widget.settings) {
    const label = el("label", "widget-setting");
    label.append(el("span", "widget-setting-label", setting.label));
    const input = el("input", "field");
    input.type = inputType(setting.type);
    input.value = setting.value;
    input.required = setting.required;
    if (setting.maxLength !== null) input.maxLength = setting.maxLength;
    input.setAttribute("aria-label", `${setting.label} for ${widget.title}`);
    input.addEventListener("change", () => {
      lastControl = { kind: "add" };
      actions.setWidgetSetting(widget.registryId, setting.id, input.value);
    });
    label.append(input);
    group.append(label);
  }
  return group;
}

function appWidgetBody(widget, actions) {
  const body = el("div", "widget-body");
  if (widget.fields.length > 0) {
    body.append(captureForm(widget));
    body.append(
      el(
        "p",
        "widget-note",
        "Sending a capture to an app is not part of this build. The fields and settings are shown as the app declared them.",
      ),
    );
  }
  if (widget.settings.length > 0) body.append(settingsEditor(widget, actions));
  if (widget.note !== null) body.append(el("p", "widget-note", widget.note));
  return body;
}

function unknownBody(widget) {
  const body = el("div", "widget-body");
  body.append(el("p", "widget-note widget-unknown", widget.note ?? ""));
  return body;
}

function widgetBody(widget, state, actions) {
  if (widget.kind === "apps") return appsBody();
  if (widget.kind === "recents") return recentsBody(state, actions);
  if (widget.kind === "app") return appWidgetBody(widget, actions);
  return unknownBody(widget);
}

/**
 * A focused placement answers Alt+Left and Alt+Right in edit mode.
 *
 * The buttons already do this by pointer and by keyboard; this is the short path for a
 * person moving several placements, and it never takes a plain arrow key.
 */
function attachMoveKeys(node, widget, index, total, actions) {
  node.tabIndex = 0;
  node.setAttribute(
    "aria-label",
    `${widget.title}, position ${index + 1} of ${total}. In edit mode, press Alt+Left or Alt+Right to move it.`,
  );
  node.addEventListener("keydown", (event) => {
    if (!editing || !event.altKey) return;
    const direction =
      event.key === "ArrowLeft" ? "earlier" : event.key === "ArrowRight" ? "later" : null;
    if (direction === null) return;
    event.preventDefault?.();
    const position = direction === "earlier" ? index : index + 2;
    lastControl = { widgetId: widget.registryId, action: direction };
    announce(`Moved ${widget.title} to position ${position} of ${total}.`);
    actions.moveWidget(widget.registryId, direction);
  });
}

function widgetShell(widget, state, actions, index, total) {
  const node = el("li", `widget widget-${widget.kind}`);
  node.dataset.widgetId = widget.registryId;
  node.dataset.size = widget.size;
  node.dataset.kind = widget.kind;
  attachMoveKeys(node, widget, index, total, actions);

  const head = el("div", "widget-head");
  const heading = el("div", "widget-heading");
  heading.append(el("h3", "widget-title", widget.title));
  if (widget.description !== null) {
    heading.append(el("p", "widget-note", widget.description));
  }
  head.append(heading);
  if (editing) head.append(widgetTools(widget, index, total, actions));
  node.append(head, widgetBody(widget, state, actions));

  return node;
}

function announce(message) {
  const status = document.getElementById("screen-status");
  if (status) status.textContent = message;
}

/** Put focus back on the control a person just used, if the redraw kept it. */
function restoreFocus() {
  if (lastControl === null) return;
  if (lastControl.kind === "add") {
    lastControl = null;
    return;
  }
  const shell =
    typeof document.querySelector === "function"
      ? document.querySelector(`[data-widget-id="${lastControl.widgetId}"]`)
      : null;
  if (!shell) {
    lastControl = null;
    return;
  }
  const selector = `[data-widget-action="${lastControl.action}"]`;
  const control = typeof shell.querySelector === "function" ? shell.querySelector(selector) : null;
  // A disabled control cannot take focus: the widget is now at the end it moved to, so
  // focus the other move button rather than dropping it back to the top of the page.
  if (control && control.disabled !== true) control.focus?.();
  else if (typeof shell.querySelector === "function")
    shell.querySelector("[data-widget-action]")?.focus?.();
  lastControl = null;
}

function fillPicker(available) {
  const picker = document.getElementById("widget-picker");
  const holder = document.getElementById("screen-add");
  if (!picker || !holder) return;
  picker.replaceChildren();
  holder.hidden = !editing || available.length === 0;
  for (const widget of available) {
    const option = el("option", null, widget.title);
    option.value = widget.registryId;
    picker.append(option);
  }
}

function editToggle(actions) {
  const button = el("button", "button screen-edit", editing ? "Done editing" : "Edit layout");
  button.type = "button";
  button.id = "screen-edit";
  button.setAttribute("aria-pressed", String(editing));
  button.addEventListener("click", () => {
    editing = !editing;
    actions.rerender();
  });
  return button;
}

/**
 * Draw the open Screen.
 *
 * `renderApps` runs after this, because the app grid's lists exist only once the widget
 * shell does. That keeps one renderer for the cards instead of two that drift.
 */
export function renderHome(state, actions) {
  const root = document.getElementById("screen");
  const note = document.getElementById("screen-note");
  if (!root || !note) return;

  const screens = state.screens;
  note.textContent = screens.note ?? "";
  note.hidden = screens.note === null;
  root.replaceChildren();

  const head = el("div", "screen-head");
  const heading = el("div", "screen-heading");
  heading.append(el("h3", "screen-name", screens.screen.name));
  heading.append(el("p", "screen-label", screens.screen.home ? "Home Screen" : "Screen"));
  head.append(heading, editToggle(actions));
  root.append(head);

  if (editing) {
    root.append(
      el(
        "p",
        "screen-edit-note",
        "Every control names the widget it changes. With a widget focused, press Alt+Left or Alt+Right to move it.",
      ),
    );
  }

  const list = el("ul", "widgets");
  for (const [index, widget] of screens.screen.widgets.entries()) {
    list.append(widgetShell(widget, state, actions, index, screens.screen.widgets.length));
  }
  root.append(list);
  fillPicker(screens.available);

  if (lastControl === null) {
    // A fresh paint is a fresh announcement; the last move is no longer the news.
    const status = document.getElementById("screen-status");
    if (status) status.textContent = STATUS_IDLE;
  }
  restoreFocus();
}

/** Exposed for the renderer test: a fresh page starts with edit mode off. */
export function resetEditing() {
  editing = false;
  lastControl = null;
}
