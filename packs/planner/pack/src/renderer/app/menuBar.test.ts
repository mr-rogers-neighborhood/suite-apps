import { describe, expect, it } from "vitest";
import { parseMenuSlots } from "@suite/contracts";
import { MENU_IDS, plannerMenuSlots, viewIdFromAction } from "./menuBar";

describe("Planner's bar material", () => {
  it("publishes something the host's contract accepts", () => {
    const parsed = parseMenuSlots(plannerMenuSlots({ view: "today", sync: null, showNav: false }));
    expect(parsed.ok).toBe(true);
  });

  it("marks the view that is showing, and offers every other one", () => {
    const slots = plannerMenuSlots({ view: "week", sync: null, showNav: false });
    const view = slots.navigation.find((control) => control.kind === "menu");
    expect(view?.kind).toBe("menu");
    if (view?.kind !== "menu") return;

    const checked = view.items.filter((item) => item.checked === true);
    expect(checked).toHaveLength(1);
    expect(checked[0]?.id).toBe("planner.view.week");
    expect(view.items.length).toBeGreaterThan(5);
  });

  it("offers the drawer toggle only when the rail is a drawer", () => {
    const narrow = plannerMenuSlots({ view: "today", sync: null, showNav: true });
    const wide = plannerMenuSlots({ view: "today", sync: null, showNav: false });
    expect(narrow.navigation.some((control) => control.kind === "buttons")).toBe(true);
    expect(wide.navigation.some((control) => control.kind === "buttons")).toBe(false);
  });

  it("says nothing about sync while the plan is local", () => {
    expect(plannerMenuSlots({ view: "today", sync: null, showNav: false }).status).toBeUndefined();
  });

  it("carries one help sentence per control that has meaning a host cannot guess", () => {
    const slots = plannerMenuSlots({ view: "today", sync: null, showNav: false });
    const view = slots.navigation.find((control) => control.kind === "menu");
    expect(view?.help?.title).toBe("Switch view");
    expect(view?.help?.body).toContain("Today");
  });
});

describe("reading a press", () => {
  it("recovers the view id from the row the host echoed", () => {
    expect(viewIdFromAction({ id: MENU_IDS.view, item: "planner.view.inbox" })).toBe("inbox");
  });

  it("ignores a press that is not one of its view rows", () => {
    expect(viewIdFromAction({ id: MENU_IDS.view })).toBeNull();
    expect(viewIdFromAction({ id: MENU_IDS.view, item: "planner.view" })).toBeNull();
    expect(viewIdFromAction({ id: MENU_IDS.navOpen })).toBeNull();
  });
});
