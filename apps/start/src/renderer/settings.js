import { el } from "./format.js";

/** Where "Support Suite" goes. One line, so it can point at whatever page should take money. */
const SUPPORT_URL = "https://github.com/mrrnbhd/suite-apps";

/** Settings reports what Start knows about itself, and nothing it does not. */
export function renderSettings(state, actions) {
  const list = document.getElementById("settings");
  if (!list) return;
  list.replaceChildren();

  const pair = (term, value, id) => {
    const valueNode = el("dd", null, value);
    if (id) valueNode.id = id;
    list.append(el("dt", null, term), valueNode);
  };

  pair("Data directory", state.settings.dataDirectory);
  pair("Documents", state.settings.documentsRoot);
  // What a reader can act on, in one idea per sentence. The ruling on who owns an update lives
  // in ADR-0001; a person only needs to know that Flatpak owns every deployment.
  pair(
    "Updates",
    "Start asks Flatpak to install or update an app, and only when you press the button. " +
      "It reads the store when this window opens. A copy you placed in a folder is yours: " +
      "Start opens it, reveals it and forgets it, but does not replace it.",
  );
  pair(
    "Network",
    "Start reads the Flatpak store over the host service. Nothing else leaves this machine.",
  );
  pair("Version", state.version);

  // The one ask in the product: a URL, no account, nothing gated. The window
  // handler opens `https` in the system browser, so this is a plain link and not
  // a channel.
  const support = el("dd");
  const link = el("a", null, "Support Suite…");
  link.href = SUPPORT_URL;
  link.rel = "noreferrer";
  link.target = "_blank";
  support.append(link);
  list.append(el("dt", null, "Support"), support);

  const roots = el("dd");
  const rootList = el("ul");
  for (const root of state.settings.installRoots) rootList.append(el("li", null, root));
  roots.append(rootList);
  list.append(el("dt", null, "Install roots"), roots);

  // Where everything is, per app, so leaving is a decision rather than a leap. A person
  // who can see the binary, the state and the documents can back them up, move them, or
  // delete them with a file manager — which is the point of a local-first app.
  const locations = state.settings.locations;
  for (const app of locations) {
    const detail = el("dd");
    const rows = el("ul");
    for (const [label, path] of [
      ["Binary", app.executable],
      ["Documents", app.documents],
      ["Data", app.data],
    ]) {
      rows.append(el("li", null, `${label}: ${path}`));
    }
    detail.append(rows);
    list.append(el("dt", null, `${app.name} ${app.version}`), detail);
  }
}
