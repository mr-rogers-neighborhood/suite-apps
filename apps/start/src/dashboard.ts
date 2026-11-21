import { SUITE_WIDGET_SIZES, type SuiteWidgetSize } from "@suite/contracts";
import type { DashboardWidgetKind } from "./shared.js";

/**
 * The dashboard's layout file.
 *
 * The decision is [Widgets and the dashboard](../../../../docs/reference/decisions.md#widgets-and-the-dashboard):
 * the layout is the host's document, an ordered list of widget ids and size classes, local
 * to this machine. Nothing here reads or writes a path — `main.ts` owns the file — so the
 * whole model is testable without a filesystem.
 *
 * Two rules shape the parser. A layout written by a newer Start is not guessed at, and a
 * layout Start cannot read is not partly shown: both fall back to the default with a
 * sentence. A widget id this build cannot resolve is dropped, named in that same sentence,
 * and left in the file until the person changes something — reinstalling the app should
 * bring the widget back, not require it to be added again.
 */

export const DASHBOARD_FORMAT = "suite.start.dashboard";

/** Bumped when the file's shape changes; an older reader falls back rather than guesses. */
export const DASHBOARD_VERSION = 1;

/** The host's own app id, so its widgets use the same `<app id>.<widget id>` form as an app's. */
export const HOST_WIDGET_APP_ID = "start";

export const APPS_WIDGET_ID = "start.apps";
export const RECENTS_WIDGET_ID = "start.recents";

export interface DashboardEntry {
  /** The registry id, `<app id>.<widget id>`. */
  readonly id: string;
  readonly size: SuiteWidgetSize;
}

export interface DashboardLayout {
  readonly format: typeof DASHBOARD_FORMAT;
  readonly version: number;
  readonly widgets: readonly DashboardEntry[];
}

export interface DashboardRead {
  readonly layout: DashboardLayout;
  /** What was repaired or dropped, for the visible note. `null` when the file was honoured. */
  readonly note: string | null;
}

/** One widget the host itself provides. An app's widgets join the same table when installed. */
export interface HostWidget {
  readonly id: string;
  readonly kind: DashboardWidgetKind;
  readonly title: string;
  readonly description: string;
  readonly sizes: readonly SuiteWidgetSize[];
  readonly defaultSize: SuiteWidgetSize;
}

/**
 * The host's widgets.
 *
 * The app grid is first because it is what Start already was; the recents list is here
 * because a layout with one widget cannot be rearranged, and it reads state the hub
 * already reports. Neither grows a new data source.
 */
export const HOST_WIDGETS: readonly HostWidget[] = [
  {
    id: APPS_WIDGET_ID,
    kind: "apps",
    title: "Apps",
    description: "Every app the suite offers, installed or not.",
    sizes: ["2x1", "full"],
    defaultSize: "full",
  },
  {
    id: RECENTS_WIDGET_ID,
    kind: "recents",
    title: "Recently opened",
    description: "The last documents Start opened for you.",
    sizes: ["1x1", "2x1", "full"],
    defaultSize: "2x1",
  },
];

/** The ids this build can draw, for a layout parser with no app widgets to add. */
export function hostWidgetIds(): ReadonlySet<string> {
  return new Set(HOST_WIDGETS.map((widget) => widget.id));
}

export function hostWidget(id: string): HostWidget | undefined {
  return HOST_WIDGETS.find((widget) => widget.id === id);
}

/**
 * The layout a machine with no file gets.
 *
 * The app grid at full width, so a fresh install is exactly the window Start had before
 * it had a dashboard.
 */
export const DEFAULT_DASHBOARD: DashboardLayout = {
  format: DASHBOARD_FORMAT,
  version: DASHBOARD_VERSION,
  widgets: [{ id: APPS_WIDGET_ID, size: "full" }],
};

/** The default, with nothing to explain. */
export function defaultDashboard(): DashboardRead {
  return { layout: DEFAULT_DASHBOARD, note: null };
}

function isSize(value: unknown): value is SuiteWidgetSize {
  return typeof value === "string" && (SUITE_WIDGET_SIZES as readonly string[]).includes(value);
}

function list(ids: readonly string[]): string {
  if (ids.length <= 1) return ids[0] ?? "";
  return `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

const CORRUPT = "Start could not read your dashboard, so it is showing the default layout.";
const NEWER =
  "Your dashboard was written by a newer Start, so this version is showing the default layout.";
const EMPTY =
  "Your dashboard had no widget this build can show, so it is showing the default layout.";

/**
 * Read a layout, forgiving what can be repaired and refusing what cannot.
 *
 * `known` is the registry: the host's widgets plus the widgets of installed apps. It is a
 * parameter rather than a global so a test can register a widget that does not exist yet,
 * which is the state the Planner lane will land in.
 */
export function parseDashboard(
  value: unknown,
  known: ReadonlySet<string> = hostWidgetIds(),
): DashboardRead {
  if (typeof value !== "object" || value === null) {
    return { layout: DEFAULT_DASHBOARD, note: CORRUPT };
  }

  const raw = value as Record<string, unknown>;
  if (raw.format !== DASHBOARD_FORMAT) return { layout: DEFAULT_DASHBOARD, note: CORRUPT };
  if (raw.version !== DASHBOARD_VERSION) {
    return {
      layout: DEFAULT_DASHBOARD,
      note: typeof raw.version === "number" && raw.version > DASHBOARD_VERSION ? NEWER : CORRUPT,
    };
  }
  if (!Array.isArray(raw.widgets)) return { layout: DEFAULT_DASHBOARD, note: CORRUPT };

  const notes: string[] = [];
  const widgets: DashboardEntry[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];
  let repeated = false;

  for (const candidate of raw.widgets) {
    if (typeof candidate !== "object" || candidate === null) {
      notes.push(CORRUPT);
      return { layout: DEFAULT_DASHBOARD, note: notes.join(" ") };
    }
    const entry = candidate as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";
    if (id.length === 0 || !isSize(entry.size)) {
      return { layout: DEFAULT_DASHBOARD, note: CORRUPT };
    }
    if (seen.has(id)) {
      repeated = true;
      continue;
    }
    seen.add(id);
    if (!known.has(id)) {
      unknown.push(id);
      continue;
    }
    const registry = hostWidget(id);
    // A stored class the widget no longer offers is a size change, not a corrupt file.
    const size =
      registry !== undefined && !registry.sizes.includes(entry.size)
        ? registry.defaultSize
        : entry.size;
    widgets.push({ id, size });
  }

  if (widgets.length === 0) {
    return { layout: DEFAULT_DASHBOARD, note: [EMPTY, ...notes].join(" ") };
  }

  if (repeated) notes.push("A repeated widget was shown once.");
  if (unknown.length > 0) {
    notes.push(`Not shown because nothing on this machine provides ${list(unknown)}.`);
  }

  return {
    layout: { format: DASHBOARD_FORMAT, version: DASHBOARD_VERSION, widgets },
    note: notes.length > 0 ? notes.join(" ") : null,
  };
}

/** Move one widget one place earlier or later; a move off either end is a no-op. */
export function moveWidget(
  layout: DashboardLayout,
  id: string,
  direction: "earlier" | "later",
): DashboardLayout {
  const index = layout.widgets.findIndex((widget) => widget.id === id);
  const target = direction === "earlier" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= layout.widgets.length) return layout;

  const widgets = [...layout.widgets];
  const [moved] = widgets.splice(index, 1);
  if (moved === undefined) return layout;
  widgets.splice(target, 0, moved);
  return { ...layout, widgets };
}

/** Place one widget at another size class, if that widget offers it. */
export function resizeWidget(
  layout: DashboardLayout,
  id: string,
  size: SuiteWidgetSize,
  sizes: readonly SuiteWidgetSize[],
): DashboardLayout {
  if (!sizes.includes(size)) return layout;
  if (!layout.widgets.some((widget) => widget.id === id)) return layout;
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => (widget.id === id ? { ...widget, size } : widget)),
  };
}

function appendWidget(layout: DashboardLayout, id: string, size: SuiteWidgetSize): DashboardLayout {
  if (layout.widgets.some((widget) => widget.id === id)) return layout;
  return { ...layout, widgets: [...layout.widgets, { id, size }] };
}

/** Add a widget at the end, at the class its descriptor asks for. */
export function addWidget(layout: DashboardLayout, id: string): DashboardLayout {
  const widget = hostWidget(id);
  return widget === undefined ? layout : appendWidget(layout, id, widget.defaultSize);
}

/**
 * Take one widget off the dashboard.
 *
 * The last one cannot be removed: an empty dashboard is a blank window, and the person
 * would have no way back from it. Removing everything is how a layout gets stuck.
 */
export function removeWidget(layout: DashboardLayout, id: string): DashboardLayout {
  if (layout.widgets.length <= 1) return layout;
  const widgets = layout.widgets.filter((widget) => widget.id !== id);
  return widgets.length === layout.widgets.length ? layout : { ...layout, widgets };
}

/** The bytes written to disk. Pretty-printed so a person can read and edit it. */
export function serializeDashboard(layout: DashboardLayout): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}
