import {
  SUITE_WIDGET_SIZES,
  type SuiteWidget,
  type SuiteWidgetSetting,
  type SuiteWidgetSize,
} from "@suite/contracts";
import type { Screen, SuiteScreenWidget, WidgetRegistry } from "@suite/screens";
import { HOST_WIDGETS, type HostWidget, hostWidget } from "./hostWidgets.js";
import type {
  AvailableScreenWidget,
  ScreenWidgetFieldView,
  ScreenWidgetSettingView,
  ScreenWidgetView,
} from "./shared.js";

/**
 * Turning a Screen into what the page draws.
 *
 * The Screen names registry ids; this module joins them to the host table and the app
 * widget registry. The host table is consulted first, because `start.apps` and
 * `start.recents` are the host's own widgets and not app declarations. An id neither
 * source knows is kept and described as unknown: showing less than the Screen says is the
 * failure this prevents.
 *
 * The joined shape here is deliberate: the renderer is plain JavaScript and gets the
 * resolved answer, so it never has to decide what a widget is or whether an unknown id may
 * be dropped.
 */

function noteList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

/** The size classes one placement may take. Host widgets keep their own list. */
export function screenWidgetSizes(
  registryId: string,
  registry: WidgetRegistry,
): readonly SuiteWidgetSize[] {
  const host = hostWidget(registryId);
  if (host !== undefined) return host.sizes;
  if (registry.resolve(registryId) !== undefined) return SUITE_WIDGET_SIZES;
  // An unknown placement still offers every class: the person may resize it, and the
  // entry is the app's when it arrives.
  return SUITE_WIDGET_SIZES;
}

/** The size a newly added placement gets, or null when nothing declares the id. */
export function widgetDefaultSize(
  registryId: string,
  registry: WidgetRegistry,
): SuiteWidgetSize | null {
  const host = hostWidget(registryId);
  if (host !== undefined) return host.defaultSize;
  const resolved = registry.resolve(registryId);
  return resolved === undefined ? null : resolved.widget.size;
}

/** The descriptor's declared setting, before an instance value is applied. */
export function widgetSettingField(
  registryId: string,
  fieldId: string,
  registry: WidgetRegistry,
): SuiteWidgetSetting | null {
  const resolved = registry.resolve(registryId);
  if (resolved === undefined) return null;
  return (resolved.widget.settings ?? []).find((setting) => setting.id === fieldId) ?? null;
}

function fields(widget: SuiteWidget): readonly ScreenWidgetFieldView[] {
  if (widget.action.kind !== "capture") return [];
  return widget.action.fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    maxLength: field.maxLength ?? null,
  }));
}

function settings(
  registryId: string,
  widget: SuiteWidget,
  registry: WidgetRegistry,
  instance: Record<string, string>,
) {
  const resolution = registry.settings(registryId, instance);
  const views: ScreenWidgetSettingView[] = (widget.settings ?? []).map((setting) => ({
    id: setting.id,
    label: setting.label,
    type: setting.type,
    value: resolution.settings[setting.id] ?? "",
    required: setting.required,
    maxLength: setting.maxLength ?? null,
  }));

  const notes: string[] = [];
  if (resolution.unknownSettings.length > 0) {
    notes.push(
      `Saved settings this widget does not declare: ${noteList([
        ...resolution.unknownSettings,
      ])}. They stay on the Screen.`,
    );
  }
  for (const issue of resolution.issues) notes.push(`${issue.path}: ${issue.message}`);

  return { views, notes, unknownSettings: resolution.unknownSettings };
}

function hostView(entry: SuiteScreenWidget, host: HostWidget) {
  return {
    registryId: entry.registryId,
    title: host.title,
    description: host.description,
    kind: host.kind,
    size: entry.size,
    sizes: host.sizes,
    submitLabel: null,
    fields: [],
    settings: [],
    unknownSettings: [],
    note: null,
  } satisfies ScreenWidgetView;
}

function appView(entry: SuiteScreenWidget, registry: WidgetRegistry, widget: SuiteWidget) {
  const resolvedSettings = settings(entry.registryId, widget, registry, entry.settings ?? {});
  return {
    registryId: entry.registryId,
    title: widget.title,
    description: null,
    kind: "app",
    size: entry.size,
    // The contract lets the host place an app widget at any class; the descriptor's
    // `size` is the class the app would like, used when it is added.
    sizes: SUITE_WIDGET_SIZES,
    submitLabel: widget.action.kind === "capture" ? widget.action.submitLabel : null,
    fields: fields(widget),
    settings: resolvedSettings.views,
    unknownSettings: resolvedSettings.unknownSettings,
    note: resolvedSettings.notes.length > 0 ? resolvedSettings.notes.join(" ") : null,
  } satisfies ScreenWidgetView;
}

function unknownView(entry: SuiteScreenWidget) {
  return {
    registryId: entry.registryId,
    title: entry.registryId,
    description: `Nothing on this machine provides ${entry.registryId} yet.`,
    kind: "unknown",
    size: entry.size,
    sizes: SUITE_WIDGET_SIZES,
    submitLabel: null,
    fields: [],
    settings: [],
    unknownSettings: [],
    note: `This widget${Object.keys(entry.settings ?? {}).length > 0 ? " and its settings stay" : " stays"} in the Screen until an installed app declares it.`,
  } satisfies ScreenWidgetView;
}

/** Resolve one placement, host table first and app registry second. */
export function resolveScreenWidget(
  entry: SuiteScreenWidget,
  registry: WidgetRegistry,
): ScreenWidgetView {
  const host = hostWidget(entry.registryId);
  if (host !== undefined) return hostView(entry, host);
  const resolved = registry.resolve(entry.registryId);
  if (resolved !== undefined) return appView(entry, registry, resolved.widget);
  return unknownView(entry);
}

/** Every placement, in the Screen's own order. */
export function resolveScreenWidgets(
  screen: Screen,
  registry: WidgetRegistry,
): readonly ScreenWidgetView[] {
  return screen.widgets.map((entry) => resolveScreenWidget(entry, registry));
}

/**
 * Widgets that can still be added.
 *
 * Host widgets come first because they are what a fresh Start has. The app registry adds
 * whatever installed manifests declare. A registry id appears once per Screen, so an id
 * already drawn is not offered again.
 */
export function availableScreenWidgets(
  screen: Screen,
  registry: WidgetRegistry,
): readonly AvailableScreenWidget[] {
  const shown = new Set(screen.widgets.map((entry) => entry.registryId));
  const available: AvailableScreenWidget[] = [];
  for (const host of HOST_WIDGETS) {
    if (shown.has(host.id)) continue;
    available.push({
      registryId: host.id,
      title: host.title,
      description: host.description,
      defaultSize: host.defaultSize,
    });
  }
  for (const resolved of registry.widgets) {
    if (shown.has(resolved.registryId)) continue;
    // A host id always resolves through the host table first; an app that declared the
    // same id does not get a second entry in the picker.
    if (hostWidget(resolved.registryId) !== undefined) continue;
    available.push({
      registryId: resolved.registryId,
      title: resolved.widget.title,
      description: null,
      defaultSize: resolved.widget.size,
    });
  }
  return available;
}
