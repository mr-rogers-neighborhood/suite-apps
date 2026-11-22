import { el } from "./format.js";

/**
 * The Screens manager.
 *
 * Start owns this surface, not an app: it lists every Screen, creates, renames,
 * duplicates and deletes one, sets Home and opens a Screen in the pane beside it. The page
 * draws only what main sends and returns the new state after each action, so the list is
 * never a second copy of the document.
 *
 * Deleting Home is a two-step answer: main refuses the first press and returns the other
 * Screens as choices. The row then asks which one should become Home before the deletion
 * can happen. The last Screen cannot be deleted at all.
 */

function actionButton(label, onClick, className = "button quiet") {
  const button = el("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function badges(screen) {
  const holder = el("span", "screen-badges");
  if (screen.home) holder.append(el("span", "screen-badge", "Home"));
  if (screen.open) holder.append(el("span", "screen-badge", "Open"));
  if (!screen.readable) {
    holder.append(el("span", "screen-badge screen-badge-warning", "Unreadable"));
  }
  return holder;
}

function replacementRow(screen, screens, actions) {
  const holder = el("div", "screen-replacement");
  holder.append(
    el("p", "screens-note", "Choose which Screen becomes Home before this one is deleted."),
  );
  const select = el("select", "screen-replacement-select");
  select.setAttribute("aria-label", `New Home in place of ${screen.name}`);
  for (const choice of screens.replacement.choices) {
    const option = el("option", null, choice.name);
    option.value = choice.id;
    select.append(option);
  }
  const confirm = actionButton(
    "Delete Home and use the chosen Screen",
    () => actions.deleteScreen(screen.id, select.value),
    "button danger",
  );
  confirm.dataset.screenAction = "delete-home";
  holder.append(select, confirm);
  return holder;
}

function screenRow(screen, screens, actions) {
  const row = el("li", "screen-row");
  row.dataset.screenId = screen.id;

  const heading = el("div", "screen-row-heading");
  heading.append(el("span", "screen-row-name", screen.name), badges(screen));
  row.append(heading);

  const tools = el("div", "screen-row-tools");
  const open = actionButton("Open", () => actions.openScreen(screen.id));
  open.dataset.screenAction = "open";
  open.disabled = screen.open || !screen.readable;
  open.setAttribute("aria-label", `Open ${screen.name}`);

  const home = actionButton("Set Home", () => actions.setHomeScreen(screen.id));
  home.dataset.screenAction = "home";
  home.disabled = screen.home || !screen.readable;
  home.setAttribute("aria-label", `Make ${screen.name} the Home Screen`);

  const duplicate = actionButton("Duplicate", () => actions.duplicateScreen(screen.id));
  duplicate.dataset.screenAction = "duplicate";
  duplicate.disabled = !screen.readable;
  duplicate.setAttribute("aria-label", `Duplicate ${screen.name}`);

  const remove = actionButton("Delete", () => actions.deleteScreen(screen.id, null));
  remove.dataset.screenAction = "delete";
  // The last Screen stays: an empty set has no surface left to create another on.
  const last = screens.screens.length <= 1;
  remove.disabled = last;
  remove.setAttribute(
    "aria-label",
    last ? `Delete ${screen.name} (the last Screen cannot be deleted)` : `Delete ${screen.name}`,
  );

  tools.append(open, home, duplicate, remove);
  row.append(tools);

  const rename = el("div", "screen-rename");
  const input = el("input", "field screen-rename-input");
  input.value = screen.name;
  input.setAttribute("aria-label", `New name for ${screen.name}`);
  const renameButton = actionButton("Rename", () => actions.renameScreen(screen.id, input.value));
  renameButton.dataset.screenAction = "rename";
  renameButton.disabled = !screen.readable;
  renameButton.setAttribute("aria-label", `Rename ${screen.name}`);
  rename.append(input, renameButton);
  row.append(rename);

  if (screens.replacement?.forId === screen.id) {
    row.append(replacementRow(screen, screens, actions));
  }

  return row;
}

/**
 * Draw the manager.
 *
 * The control names carry the Screen they act on, so a list of similarly named Screens is
 * still navigable by a screen reader. The create row is the one place a new Screen starts;
 * a new Screen is empty and offers the add picker in the Home pane.
 */
export function renderScreens(state, actions) {
  const root = document.getElementById("screens-manager-body");
  if (!root) return;

  const screens = state.screens;
  root.replaceChildren();

  root.append(
    el(
      "p",
      "screens-intro",
      "Screens are part of Start, not an app. Home is the Screen Start opens; Open shows another Screen here without changing Home.",
    ),
  );

  if (screens.managerNote !== null) {
    root.append(el("p", "screens-note", screens.managerNote));
  }

  const list = el("ul", "screens-list");
  for (const screen of screens.screens) {
    list.append(screenRow(screen, screens, actions));
  }
  root.append(list);

  if (screens.screens.length <= 1) {
    root.append(
      el(
        "p",
        "screens-note",
        "This is the last Screen. Start keeps it so there is always a surface to add another on.",
      ),
    );
  }

  const create = el("div", "screen-create");
  const input = el("input", "field screen-create-input");
  input.id = "screen-new-name";
  input.placeholder = "New Screen name";
  input.setAttribute("aria-label", "New Screen name");
  const createButton = actionButton(
    "Create Screen",
    () => actions.createScreen(input.value),
    "button",
  );
  createButton.id = "screen-create";
  create.append(input, createButton);
  root.append(create);
}
