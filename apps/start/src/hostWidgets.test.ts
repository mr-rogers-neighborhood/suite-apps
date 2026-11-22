import { SUITE_WIDGET_SIZES } from "@suite/contracts";
import { isWidgetRegistryId } from "@suite/screens";
import { describe, expect, it } from "vitest";
import {
  APPS_WIDGET_ID,
  HOST_WIDGETS,
  hostWidget,
  hostWidgetIds,
  RECENTS_WIDGET_ID,
} from "./hostWidgets.js";

/**
 * The host's own widget table.
 *
 * These entries are deliberately not `SuiteWidget` descriptors: Start provides them, no
 * app declares them, and they have no capture action. The one thing worth holding is that
 * they still use the registry-id shape a Screen names, so the table and the app registry
 * can be resolved in one pass.
 */

describe("the host widget table", () => {
  it("names the app grid and the recents list with registry ids", () => {
    expect(hostWidgetIds()).toEqual(new Set([APPS_WIDGET_ID, RECENTS_WIDGET_ID]));
    for (const widget of HOST_WIDGETS) {
      expect(isWidgetRegistryId(widget.id)).toBe(true);
    }
  });

  it("offers each default size among the sizes it declares", () => {
    for (const widget of HOST_WIDGETS) {
      expect(widget.sizes).toContain(widget.defaultSize);
      for (const size of widget.sizes) expect(SUITE_WIDGET_SIZES).toContain(size);
    }
  });

  it("resolves only its own ids", () => {
    expect(hostWidget(APPS_WIDGET_ID)?.kind).toBe("apps");
    expect(hostWidget(RECENTS_WIDGET_ID)?.kind).toBe("recents");
    expect(hostWidget("planner.quick-task")).toBeUndefined();
  });
});
