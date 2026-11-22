import { SUITE_WIDGET_SIZES, type SuiteWidget, type SuiteWidgetSize } from "@suite/contracts";
import {
  createWidgetRegistry,
  type Screen,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  type SuiteScreenWidget,
  type WidgetRegistry,
} from "@suite/screens";
import type { PackInfo } from "./packs.js";
import type { ScreenStore } from "./screens.js";
import type {
  ScreenChoiceView,
  ScreenView,
  ScreenWidgetFieldView,
  ScreenWidgetView,
  ShellSurface,
} from "./shared.js";
import type { SpaceState, SpaceStore } from "./spaces.js";

/**
 * Home, and the widget composition it draws.
 *
 * Home is an ordinary Screen: the host's document with a `shell.apps` placement. The
 * host widget table below is deliberately not a `SuiteWidget` descriptor. `shell.apps`
 * has no capture action and no app behind it; it is shell chrome that happens to be
 * addressed by the same `<app id>.<widget id>` grammar. The registry is built only from
 * installed pack manifests, so an app can never declare itself into a host surface.
 *
 * Everything here is pure. The Screen document, the space document and Electron live
 * behind their own modules, which keeps the composition testable without a window.
 */

export const HOME_SCREEN_ID = "shell-home";
export const HOME_SCREEN_NAME = "Home";
export const SHELL_HOST_APP_ID = "shell";
export const SHELL_APPS_WIDGET = "shell.apps";

/** A widget the shell renders itself. It is not an app descriptor and has no capture. */
export interface HostWidget {
  readonly registryId: string;
  readonly title: string;
  readonly size: SuiteWidgetSize;
  /** What this widget draws, in one sentence for the chrome. */
  readonly note: string;
}

export const SHELL_HOST_WIDGETS: readonly HostWidget[] = [
  {
    registryId: SHELL_APPS_WIDGET,
    title: "Apps",
    size: "full",
    note: "The installed packs, the local catalogue and Add pack.",
  },
];

export function hostWidget(registryId: string): HostWidget | undefined {
  return SHELL_HOST_WIDGETS.find((widget) => widget.registryId === registryId);
}

/** The Screen a new data root starts with: Home, with the host app grid filling the row. */
export function defaultHomeScreen(): Screen {
  return {
    format: SUITE_SCREEN_FORMAT,
    version: SUITE_SCREEN_VERSION,
    id: HOME_SCREEN_ID,
    name: HOME_SCREEN_NAME,
    widgets: [{ registryId: SHELL_APPS_WIDGET, size: "full" }],
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
 * a pack that happens to be called `shell` cannot shadow `shell.apps`.
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
 * in the document; it is not a renderer-side omission.
 */
export function screenView(
  screen: Screen,
  packs: readonly PackInfo[],
  registry: WidgetRegistry = shellWidgetRegistry(packs),
): ScreenView {
  return {
    id: screen.id,
    name: screen.name,
    available: true,
    widgets: screen.widgets.map((placement) => screenWidgetView(placement, packs, registry)),
    choices: screenChoices(packs, registry),
  };
}

function screenWidgetView(
  placement: SuiteScreenWidget,
  packs: readonly PackInfo[],
  registry: WidgetRegistry,
): ScreenWidgetView {
  const host = hostWidget(placement.registryId);
  if (host !== undefined) {
    return {
      registryId: placement.registryId,
      size: placement.size,
      source: "host",
      title: host.title,
      appId: SHELL_HOST_APP_ID,
      appName: "Suite",
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

  for (const host of SHELL_HOST_WIDGETS) {
    seen.add(host.registryId);
    choices.push({
      registryId: host.registryId,
      title: host.title,
      source: "host",
      appId: SHELL_HOST_APP_ID,
      appName: "Suite",
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
 * The Screen store already creates Home when the file is missing. This adds the tab
 * that shows it: first in the strip on a fresh document, and active because a fresh
 * space document has no active tab. A restored session keeps its active tab and only
 * gains Home at the front.
 */
export async function openHomeScreen(screens: ScreenStore, spaces: SpaceStore): Promise<HomeOpen> {
  const screen = screens.state();
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
