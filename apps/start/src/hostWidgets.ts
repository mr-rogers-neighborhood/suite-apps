import type { SuiteWidgetSize } from "@suite/contracts";

/**
 * The widgets Start itself provides.
 *
 * These are not app declarations. `start.apps` and `start.recents` use the same registry-id
 * shape as an app widget so a Screen can name them in one ordered list, but they resolve
 * through this table rather than through the app widget registry: they have no manifest,
 * no capture action and no owning app. The registry is for apps.
 *
 * The app grid is first because it is what Start already was; the recents list is here
 * because a Screen with one widget cannot be rearranged, and it reads state the hub
 * already reports. Neither grows a new data source.
 */

/** The host's own app id, so its widgets use the same `<app id>.<widget id>` form as an app's. */
export const HOST_WIDGET_APP_ID = "start";

export const APPS_WIDGET_ID = "start.apps";
export const RECENTS_WIDGET_ID = "start.recents";

/** Which body the Home Screen draws for a host widget. */
export type HostWidgetKind = "apps" | "recents";

export interface HostWidget {
  readonly id: string;
  readonly kind: HostWidgetKind;
  readonly title: string;
  readonly description: string;
  readonly sizes: readonly SuiteWidgetSize[];
  readonly defaultSize: SuiteWidgetSize;
}

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

/** The ids this build can draw from its own table. */
export function hostWidgetIds(): ReadonlySet<string> {
  return new Set(HOST_WIDGETS.map((widget) => widget.id));
}

export function hostWidget(id: string): HostWidget | undefined {
  return HOST_WIDGETS.find((widget) => widget.id === id);
}
