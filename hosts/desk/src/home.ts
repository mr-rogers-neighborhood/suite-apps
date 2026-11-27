import { SUITE_WIDGET_SIZES, type SuiteWidget, type SuiteWidgetSize } from "@suite/contracts";
import {
  createWidgetRegistry,
  isScreenRow,
  type Screen,
  type ScreenEntry,
  type ScreenEntryLayout,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  type SuiteScreenRowItem,
  type SuiteScreenWidget,
  screenLayout,
  sizeCells,
  type WidgetRegistry,
} from "@suite/screens";
import type { PackInfo } from "./packs.js";
import type { ScreenSet } from "./screens.js";
import type {
  ScreenChoiceView,
  ScreenEntryView,
  ScreenRowView,
  ScreenView,
  ScreenWidgetFieldView,
  ScreenWidgetView,
  ShellSurface,
} from "./shared.js";
import type { SpaceState, SpaceStore } from "./spaces.js";

/**
 * Home, and the widget composition it draws.
 *
 * Home is an ordinary Screen: the host's document with a `desk.apps` placement. The
 * host widget table below is deliberately not a `SuiteWidget` descriptor. `desk.apps`
 * has no capture action and no app behind it; it is host chrome that happens to be
 * addressed by the same `<app id>.<widget id>` grammar. The registry is built only from
 * installed pack manifests, so an app can never declare itself into a host surface.
 *
 * Everything here is pure. The Screen document, the space document and Electron live
 * behind their own modules, which keeps the composition testable without a window.
 */

export const HOME_SCREEN_ID = "desk-home";
export const HOME_SCREEN_NAME = "Home";
export const DESK_HOST_APP_ID = "desk";
export const DESK_APPS_WIDGET = "desk.apps";

/** A widget the host renders itself. It is not an app descriptor and has no capture. */
export interface HostWidget {
  readonly registryId: string;
  readonly title: string;
  readonly size: SuiteWidgetSize;
  /** What this widget draws, in one sentence for the chrome. */
  readonly note: string;
}

export const DESK_HOST_WIDGETS: readonly HostWidget[] = [
  {
    registryId: DESK_APPS_WIDGET,
    title: "Apps",
    size: "full",
    note: "The installed packs, the local catalogue and Add pack.",
  },
];

export function hostWidget(registryId: string): HostWidget | undefined {
  return DESK_HOST_WIDGETS.find((widget) => widget.registryId === registryId);
}

/** The Screen a new data root starts with: an empty Home, ready for the person's widgets. */
export function defaultHomeScreen(): Screen {
  return {
    format: SUITE_SCREEN_FORMAT,
    version: SUITE_SCREEN_VERSION,
    id: HOME_SCREEN_ID,
    name: HOME_SCREEN_NAME,
    widgets: [],
  };
}

/** True when the string is one of the contract's three size classes. */
export function isWidgetSize(value: string): value is SuiteWidgetSize {
  return (SUITE_WIDGET_SIZES as readonly string[]).includes(value);
}

/**
 * The registry of app widgets declared by the installed packs.
 *
 * Host widgets are absent on purpose: they are resolved from the host table first, so
 * a pack that happens to be called `desk` cannot shadow `desk.apps`.
 */
export function shellWidgetRegistry(packs: readonly PackInfo[]): WidgetRegistry {
  return createWidgetRegistry(
    packs.map((pack) => ({ appId: pack.id, widgets: pack.widgets ?? [] })),
  );
}

/** What edit mode adds for a registry id: the host table wins, then the descriptor. */
export function preferredWidgetSize(registryId: string, registry: WidgetRegistry): SuiteWidgetSize {
  const host = hostWidget(registryId);
  if (host !== undefined) return host.size;
  return registry.resolve(registryId)?.widget.size ?? "2x1";
}

/**
 * Build the Screen the chrome draws.
 *
 * A host id resolves from the host table, an installed app id from the registry, and
 * anything else is a named placeholder with a sentence. The unknown placement is still
 * in the document; it is not a renderer-side omission. A row is laid out by the shared
 * layout function, so the same weights produce a wrap on a wide window and a scroll on
 * a phone.
 */
export function screenView(
  screen: Screen,
  packs: readonly PackInfo[],
  registry: WidgetRegistry = shellWidgetRegistry(packs),
  viewportWidth = 1024,
): ScreenView {
  const layout = screenLayout(screen, { width: viewportWidth });
  // The layout is in visual order; `index` maps it back to the document entry.
  const byIndex = new Map(layout.entries.map((entry) => [entry.index, entry]));
  return {
    id: screen.id,
    name: screen.name,
    available: true,
    narrow: layout.narrow,
    widgets: screen.widgets.map((entry, index) =>
      screenEntryView(entry, byIndex.get(index), packs, registry),
    ),
    choices: screenChoices(packs, registry),
  };
}

function screenEntryView(
  entry: ScreenEntry,
  layout: ScreenEntryLayout | undefined,
  packs: readonly PackInfo[],
  registry: WidgetRegistry,
): ScreenEntryView {
  if (!isScreenRow(entry)) return screenWidgetView(entry, packs, registry, layout);

  const view: ScreenRowView = {
    kind: "row",
    size: entry.size,
    x: layout?.x ?? entry.x,
    y: layout?.y ?? entry.y,
    w: layout?.w ?? sizeCells(entry.size).w,
    h: layout?.h ?? sizeCells(entry.size).h,
    layout: entry.layout,
    mode: layout?.kind === "row" ? layout.mode : "wrap",
    items: entry.items.map((item) => ({
      weight: item.weight,
      widget: rowItemWidgetView(item, entry.size, packs, registry),
    })),
  };
  return view;
}

function rowItemWidgetView(
  item: SuiteScreenRowItem,
  rowSize: SuiteWidgetSize,
  packs: readonly PackInfo[],
  registry: WidgetRegistry,
): ScreenWidgetView {
  return screenWidgetView(
    {
      registryId: item.registryId,
      size: rowSize,
      ...(item.settings === undefined ? {} : { settings: item.settings }),
    },
    packs,
    registry,
  );
}

function screenWidgetView(
  placement: Pick<SuiteScreenWidget, "registryId" | "size"> & {
    readonly settings?: Record<string, string> | undefined;
  },
  packs: readonly PackInfo[],
  registry: WidgetRegistry,
  layout?: ScreenEntryLayout,
): ScreenWidgetView {
  const cells = layout === undefined ? {} : { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
  const host = hostWidget(placement.registryId);
  if (host !== undefined) {
    return {
      ...cells,
      kind: "widget",
      registryId: placement.registryId,
      size: placement.size,
      source: "host",
      title: host.title,
      appId: DESK_HOST_APP_ID,
      appName: "Suite Desk",
      note: host.note,
      fields: [],
      settings: [],
      unknownSettings: [],
      issues: [],
    };
  }

  const resolved = registry.resolve(placement.registryId);
  if (resolved === undefined) {
    return {
      ...cells,
      kind: "widget",
      registryId: placement.registryId,
      size: placement.size,
      source: "unknown",
      title: placement.registryId,
      appId: null,
      appName: null,
      note: `${placement.registryId} is not installed here. The placement and its settings stay in this Screen.`,
      fields: [],
      settings: [],
      unknownSettings: Object.keys(placement.settings ?? {}),
      issues: [],
    };
  }

  const pack = packs.find((candidate) => candidate.id === resolved.appId);
  const appName = pack?.name ?? resolved.appId;
  const resolution = registry.settings(placement.registryId, placement.settings ?? {});

  return {
    ...cells,
    kind: "widget",
    registryId: placement.registryId,
    size: placement.size,
    source: "app",
    title: resolved.widget.title,
    appId: resolved.appId,
    appName,
    note: `Sending a capture to ${appName} is not available in this build yet.`,
    fields: fieldViews(resolved.widget),
    settings: resolved.settings.map((setting) => ({
      id: setting.id,
      label: setting.label,
      value: resolution.settings[setting.id] ?? "",
    })),
    unknownSettings: resolution.unknownSettings,
    issues: resolution.issues.map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path}: ${issue.message}`,
    ),
  };
}

function fieldViews(widget: SuiteWidget): readonly ScreenWidgetFieldView[] {
  return widget.action.fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
  }));
}

/** Everything edit mode may add: host widgets first, then each installed app's own. */
export function screenChoices(
  packs: readonly PackInfo[],
  registry: WidgetRegistry = shellWidgetRegistry(packs),
): readonly ScreenChoiceView[] {
  const seen = new Set<string>();
  const choices: ScreenChoiceView[] = [];

  for (const host of DESK_HOST_WIDGETS) {
    seen.add(host.registryId);
    choices.push({
      registryId: host.registryId,
      title: host.title,
      source: "host",
      appId: DESK_HOST_APP_ID,
      appName: "Suite Desk",
      size: host.size,
    });
  }

  for (const resolved of registry.widgets) {
    if (seen.has(resolved.registryId)) continue;
    seen.add(resolved.registryId);
    const pack = packs.find((candidate) => candidate.id === resolved.appId);
    choices.push({
      registryId: resolved.registryId,
      title: resolved.widget.title,
      source: "app",
      appId: resolved.appId,
      appName: pack?.name ?? resolved.appId,
      size: resolved.widget.size,
    });
  }

  return choices;
}

/** Which surface the chrome paints, from the restored tab state. */
export function shellSurface(state: Pick<SpaceState, "tabs" | "activeTabId">): ShellSurface {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (active === undefined) return "launcher";
  return active.kind === "screen" ? "screen" : "pack";
}

export interface HomeOpen {
  readonly screenId: string;
  readonly title: string;
  readonly tabId: string;
  /** True when this call opened the tab, rather than reusing one that existed. */
  readonly opened: boolean;
}

/**
 * Open Home before any pack.
 *
 * The Screen set already creates Home when the file is missing. This adds the tab
 * that shows it: first in the strip on a fresh document, and active because a fresh
 * space document has no active tab. A restored session keeps its active tab and only
 * gains Home at the front.
 */
export async function openHomeScreen(screens: ScreenSet, spaces: SpaceStore): Promise<HomeOpen> {
  const screen = screens.screen(screens.homeId);
  if (screen === null) throw new Error("the host has no Home Screen");
  const ensured = await spaces.ensureScreenTab({
    screenId: screen.id,
    title: screen.name,
    first: true,
  });
  return {
    screenId: screen.id,
    title: screen.name,
    tabId: ensured.tab.id,
    opened: ensured.opened,
  };
}

/**
 * Remove the old host app grid from Home, once.
 *
 * `desk.apps` was Home's launcher before the picker became the new-tab surface. A Screen that
 * still carries it keeps every other widget; an old default Home becomes empty and the Suite
 * mark and the picker carry the next action. The placement is removed from the document, not
 * hidden in the view. The caller records the migration, so adding it back is not undone.
 */
export async function migrateHome(screens: ScreenSet): Promise<void> {
  const screen = screens.screen(screens.homeId);
  if (screen === null) return;
  const legacy = screen.widgets.some(
    (entry) => !isScreenRow(entry) && entry.registryId === DESK_APPS_WIDGET,
  );
  if (!legacy) return;
  await screens.store(screen.id)?.remove(DESK_APPS_WIDGET);
}
