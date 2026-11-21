import { el, relativeTime } from "./format.js";

/**
 * The line under a card's title, which is the whole point of the states.
 *
 * Every state says something true and different. "Not installed yet" is an invitation;
 * "no release found" is an honest absence; the others are a version and where it stands.
 * Linux desktop apps ship as Flatpaks, so there is no download to describe.
 */
function stateLine(card) {
  const running = card.running ? " · running" : "";
  // Flatpak is a writer, not a folder: the app updates when Flatpak updates it, and
  // saying "updates itself" or "up to date" would both be claims this hub cannot make.
  if (card.source === "flatpak") {
    const newer = card.state === "update-available" ? " · update available" : "";
    return `${card.version} · Flatpak${newer}${running}`;
  }
  if (card.state === "not-installed") {
    return "Not installed yet · from the store";
  }
  if (card.state === "no-release") {
    return card.version === null ? "No release found" : `${card.version} · no release found`;
  }
  if (card.state === "local") {
    // A copy Start did not place is not Start's to replace. Nothing in the hub downloads
    // a newer one, so saying it "updates itself" would promise a download that never
    // happens; what is true is that its updates are somebody else's to make.
    return `${card.version} · from a folder · Start does not update it${running}`;
  }
  return `${card.version} · up to date${running}`;
}

function fileCountLabel(count) {
  if (count === 0) return "No files";
  return count === 1 ? "1 file" : `${count} files`;
}

/** A store operation's line, which takes the button's place while it runs. */
function progressBar(card) {
  const holder = el("div", "card-progress");
  const bar = el("progress", "card-progress-bar");
  bar.max = 100;
  bar.removeAttribute("value");
  holder.append(bar, el("span", "card-progress-label", "Installing…"));
  holder.dataset.state = "installing";
  holder.setAttribute("role", "status");
  holder.setAttribute("aria-label", `Installing ${card.name}`);
  return holder;
}

/** The buttons one card offers, which differ by state and by whether an operation is running. */
function cardActions(card, actions) {
  const buttons = el("div", "card-actions");

  const button = (label, className, onClick) => {
    const node = el("button", `button ${className}`, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };

  if (card.state === "not-installed" && card.id !== null) {
    buttons.append(
      button(`Install ${card.name}`, "primary", () =>
        actions.install(card.id, card.switchTier ?? undefined),
      ),
    );
    return buttons;
  }

  // Nothing is installed, so there is nothing to open and nothing to remove.
  if (card.id === null || card.version === null) return buttons;

  if (card.state === "update-available") {
    buttons.append(button("Update", "primary", () => actions.install(card.id)));
    buttons.append(button("Open", "quiet", () => actions.launch(card.id)));
  } else {
    buttons.append(button("Open", "primary", () => actions.launch(card.id)));
  }

  if (card.state === "local") {
    // A copy Start did not install: it can open it, show where it is, and stop listing it.
    // Deleting it is not Start's to do — the person put it there.
    buttons.append(button("Reveal", "quiet", () => actions.reveal(card.id)));
    buttons.append(button("Forget", "quiet", () => actions.remove(card.id)));
    return buttons;
  }

  if (card.source === "flatpak") {
    // One pre-release id, one deployment: another tier is a switch, never a second
    // install. The backend replaces the deployment and keeps the install.
    if (card.switchTier !== null) {
      buttons.append(
        button(`Switch to ${card.switchTier}`, "quiet", () =>
          actions.install(card.id, card.switchTier),
        ),
      );
    }
    // Flatpak owns the deployment. Start can say where it is and ask Flatpak to remove
    // it; replacing the files is the one thing it must not do (ADR-0001).
    buttons.append(button("Reveal", "quiet", () => actions.reveal(card.id)));
    buttons.append(button("Uninstall", "quiet", () => actions.uninstall(card.id)));
  }
  return buttons;
}

function appCard(card, actions, progress, launchError) {
  const node = el("li", card.health.ok ? "card" : "card card-refused");
  if (card.id !== null) node.dataset.appId = card.id;
  node.dataset.state = card.state;

  const title = el("div", "card-title");
  // The app's own mark, so a card and the window it opens look like the same thing.
  if (card.icon !== null) {
    const mark = el("img", "card-mark");
    mark.src = card.icon;
    mark.alt = "";
    mark.width = 24;
    mark.height = 24;
    title.append(mark);
  }
  title.append(el("span", "card-name", card.name));
  // What the app honestly is, said in words. A tier is a promise about how much to
  // trust the thing, and a badge must survive a screenshot without relying on colour.
  if (card.tier !== "stable") {
    const badge = el("span", "card-channel", card.tier);
    badge.title = `${card.tier} pre-release tier`;
    title.append(badge);
  }
  node.append(title);

  if (!card.health.ok) {
    node.append(el("p", "card-health", card.health.reason));
    return node;
  }

  // An install that failed and a launch that died share one slot: it is the sentence
  // that explains why the thing the person pressed did not happen.
  const problem = progress?.phase === "failed" ? progress.reason : (launchError ?? null);
  const line = el("p", "card-meta card-state", problem ?? stateLine(card));
  if (problem !== null) line.dataset.state = "failed";
  node.append(line);

  // A badge is not a warning. A pre-release says the risk and the removal path in
  // words, on the card, before anything is pressed.
  if (card.channelNotice !== null) {
    node.append(el("p", "card-meta card-channel-notice", card.channelNotice));
  }

  if (card.version !== null) {
    const opens = card.fileExtensions.join(", ") || "no files";
    node.append(el("p", "card-meta", `Opens ${opens} · ${relativeTime(card.lastOpenedAt)}`));
    node.append(el("p", "card-meta card-files", fileCountLabel(card.fileCount)));
  }

  const busy = progress?.phase === "installing";
  if (busy) node.append(progressBar(card));
  else node.append(cardActions(card, actions));

  return node;
}

/**
 * The hub's own row.
 *
 * A Flatpak Start has a writer: Flatpak owns the deployment, so the row can ask
 * Flatpak for the newest build and say that the result appears at the next launch.
 */
function selfRow(card) {
  const node = el("li", "card card-self");
  node.dataset.appId = card.id ?? "start";
  const title = el("div", "card-title");
  title.append(el("span", "card-name", card.name), el("span", "card-version", card.version));
  node.append(title);

  const why = card.reason ?? "no release found";
  const sentence = `${why.charAt(0).toUpperCase()}${why.slice(1)}.`;
  const canUpdate = card.source === "flatpak" && card.state === "update-available";

  const says = canUpdate
    ? `${sentence} Update asks Flatpak for the newest build.`
    : `${sentence} Start cannot replace its own running binary.`;
  const note = el("p", "card-meta card-self-note", says);

  if (canUpdate) {
    const update = el("button", "button primary", "Update Start");
    update.type = "button";
    update.addEventListener("click", () => actions.install(card.id ?? "start"));
    note.append(" ", update);
  }
  node.append(note);
  return node;
}

/**
 * The Apps pane.
 *
 * A card that cannot be launched has no Open button, because the alternative is a button
 * that fails. What is wrong with it is a line on the card rather than a second list
 * somewhere else.
 */
export function renderApps(state, actions) {
  const list = document.getElementById("apps");
  const empty = document.getElementById("apps-empty");
  if (!list || !empty) return;
  list.replaceChildren();

  const progressById = new Map((state.installing ?? []).map((entry) => [entry.id, entry]));
  const launchErrors = state.launchErrors ?? {};
  empty.hidden = state.apps.length > 0;
  for (const card of state.apps) {
    list.append(
      appCard(
        card,
        actions,
        card.id === null ? undefined : progressById.get(card.id),
        card.id === null ? null : (launchErrors[card.id] ?? null),
      ),
    );
  }
  if (state.self) list.append(selfRow(state.self));
}
