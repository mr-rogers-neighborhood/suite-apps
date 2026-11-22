import {
  type ContractIssue,
  parseWidgetCapture,
  type SuiteWidget,
  type SuiteWidgetCapture,
  type SuiteWidgetSetting,
  splitWidgetRegistryId,
  suiteAppIdSchema,
  suiteWidgetIdSchema,
  widgetRegistryId,
  widgetSettingValueProblem,
} from "@suite/contracts";

/**
 * The host-side registry.
 *
 * Start and the shell both need the same answers: which descriptors this host can draw,
 * what a registry id resolves to, what an instance's settings become after defaults, and
 * what a capture looks like. None of that needs a window, so it lives here.
 *
 * A descriptor is registered under `<app id>.<widget id>`. A host widget is the same
 * shape with the host's own app id: `start.apps` and `start.recents` are ordinary
 * entries, not a second table.
 */

export interface WidgetSource {
  readonly appId: string;
  readonly widgets: readonly SuiteWidget[];
}

export interface ResolvedWidget {
  /** `<app id>.<widget id>`. */
  readonly registryId: string;
  readonly appId: string;
  readonly widget: SuiteWidget;
  readonly settings: readonly SuiteWidgetSetting[];
}

export interface WidgetSettingsResolution {
  /** Defaults applied, instance values kept, unknown keys kept. */
  readonly settings: Readonly<Record<string, string>>;
  /** Instance keys the descriptor does not declare. They stay on the Screen. */
  readonly unknownSettings: readonly string[];
  /** Values that do not fit their declared field. */
  readonly issues: readonly ContractIssue[];
}

export interface WidgetCaptureBuild {
  readonly capture: SuiteWidgetCapture;
  /** Settings that must be fixed before sending; unknown keys are not here. */
  readonly issues: readonly ContractIssue[];
  /** Kept on the Screen but not sent, because this descriptor cannot declare them. */
  readonly unknownSettings: readonly string[];
}

export interface WidgetRegistry {
  readonly widgets: readonly ResolvedWidget[];
  resolve(registryId: string): ResolvedWidget | undefined;
  /** Apply defaults and validate one instance's settings. */
  settings(
    registryId: string,
    instance?: Readonly<Record<string, string>>,
  ): WidgetSettingsResolution;
  /** Build the capture payload for one instance. */
  capture(
    registryId: string,
    values: Readonly<Record<string, string>>,
    instance?: Readonly<Record<string, string>>,
  ): WidgetCaptureBuild | undefined;
}

/** Resolve one app's declared widgets, in the order the app declared them. */
export function resolveWidgets(
  appId: string,
  widgets: readonly SuiteWidget[],
): readonly ResolvedWidget[] {
  if (!suiteAppIdSchema.safeParse(appId).success) return [];
  return widgets.map((widget) => ({
    registryId: widgetRegistryId(appId, widget.id),
    appId,
    widget,
    settings: widget.settings ?? [],
  }));
}

/**
 * Build a registry from host widgets and app declarations.
 *
 * The first descriptor for a registry id wins. A duplicate means two sources claim the
 * same id, which is a manifest mistake rather than something to merge; keeping the first
 * makes the registry deterministic without letting the later one shadow it.
 */
export function createWidgetRegistry(sources: readonly WidgetSource[]): WidgetRegistry {
  const byId = new Map<string, ResolvedWidget>();
  for (const source of sources) {
    for (const resolved of resolveWidgets(source.appId, source.widgets)) {
      if (!byId.has(resolved.registryId)) byId.set(resolved.registryId, resolved);
    }
  }

  const widgets = [...byId.values()];
  return {
    widgets,
    resolve(registryId) {
      return byId.get(registryId);
    },
    settings(registryId, instance = {}) {
      const resolved = byId.get(registryId);
      if (resolved === undefined) return resolveWidgetSettings(undefined, instance);
      return resolveWidgetSettings(resolved.widget, instance);
    },
    capture(registryId, values, instance = {}) {
      const resolved = byId.get(registryId);
      if (resolved === undefined) return undefined;
      return buildWidgetCapture(resolved.widget, values, instance);
    },
  };
}

/**
 * Apply a descriptor's defaults, keep each instance value, and report what does not fit.
 *
 * Unknown keys are not dropped: a Screen may have been written by an app version that
 * declared a setting this build does not know, and reinstalling or updating the app
 * should bring it back. They are returned in the record and named separately.
 */
export function resolveWidgetSettings(
  widget: SuiteWidget | undefined,
  instance: Readonly<Record<string, string>> = {},
): WidgetSettingsResolution {
  const declared = new Map((widget?.settings ?? []).map((setting) => [setting.id, setting]));
  const settings: Record<string, string> = {};
  for (const setting of declared.values()) {
    if (setting.default !== undefined) settings[setting.id] = setting.default;
  }
  for (const [key, value] of Object.entries(instance)) settings[key] = value;

  const unknownSettings = Object.keys(instance).filter((key) => !declared.has(key));
  const issues: ContractIssue[] = [];

  for (const setting of declared.values()) {
    const value = settings[setting.id];
    if (value === undefined || value.trim().length === 0) {
      if (setting.required && setting.default === undefined) {
        issues.push({ path: `settings.${setting.id}`, message: "required" });
      }
      continue;
    }
    const problem = widgetSettingValueProblem(setting, value);
    if (problem !== null) {
      issues.push({ path: `settings.${setting.id}`, message: problem });
    }
  }

  return { settings, unknownSettings, issues };
}

/** A descriptor's defaults, without an instance. */
export function widgetSettingDefaults(widget: SuiteWidget): Readonly<Record<string, string>> {
  return resolveWidgetSettings(widget).settings;
}

function uniqueIssues(issues: readonly ContractIssue[]): readonly ContractIssue[] {
  const seen = new Set<string>();
  const unique: ContractIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.path}\u0000${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

/**
 * Build `{ widget, action, values, settings }` for one instance.
 *
 * Declared defaults are applied, and only declared settings are sent. An unknown setting
 * stays on the Screen: the receiving app cannot use a key its descriptor does not name,
 * and sending it would make a strict parser refuse the whole capture. It is reported
 * instead, so the host can show that the saved value is not in use.
 */
export function buildWidgetCapture(
  widget: SuiteWidget,
  values: Readonly<Record<string, string>>,
  instance: Readonly<Record<string, string>> = {},
): WidgetCaptureBuild {
  const resolution = resolveWidgetSettings(widget, instance);
  const declared = new Set((widget.settings ?? []).map((setting) => setting.id));
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolution.settings)) {
    if (declared.has(key)) settings[key] = value;
  }

  const parsed = parseWidgetCapture(
    { widget: widget.id, action: "capture", values, settings },
    widget,
  );
  const issues = uniqueIssues([
    ...resolution.issues.filter((issue) => issue.path.startsWith("settings.")),
    ...(parsed.ok ? [] : parsed.issues),
  ]);

  const capture: SuiteWidgetCapture = parsed.ok
    ? parsed.value
    : { widget: widget.id, action: "capture", values: { ...values }, settings };

  return { capture, issues, unknownSettings: resolution.unknownSettings };
}

/** One descriptor's registry id without building a registry. */
export function resolvedWidget(appId: string, widget: SuiteWidget): ResolvedWidget | undefined {
  const resolved = resolveWidgets(appId, [widget])[0];
  return resolved;
}

/** Whether a string is a registry id, using the contract's splitter. */
export function isWidgetRegistryId(value: string): boolean {
  return splitWidgetRegistryId(value) !== null;
}

/** Whether a string is a setting field id. */
export function isWidgetSettingId(value: string): boolean {
  return suiteWidgetIdSchema.safeParse(value).success;
}
