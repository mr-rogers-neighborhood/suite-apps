import { describe, expect, it } from "vitest";
import { ScreenDocument } from "./document.js";
import { HOME_SCREEN_FIXTURE, homeScreen, homeScreenDocument } from "./fixture.js";
import { isScreenRow } from "./screen.js";

describe("the shared Home fixture", () => {
  it("is a valid Screen with one row composition", () => {
    expect(homeScreen().id).toBe("home");
    expect(homeScreen().version).toBe(3);
    expect(
      homeScreen().widgets.map((entry) => (isScreenRow(entry) ? entry.kind : entry.registryId)),
    ).toEqual(["desk.apps", "row"]);

    const row = homeScreen().widgets[1];
    expect(row !== undefined && isScreenRow(row)).toBe(true);
    if (row === undefined || !isScreenRow(row)) return;
    expect(row.items.map((item) => item.registryId)).toEqual([
      "planner.quick-task",
      "budget.saved-views",
    ]);
  });

  it("turns the JSON into a Loro document that round-trips", () => {
    const document = homeScreenDocument();
    expect(document.state()).toEqual(homeScreen());

    const reopened = ScreenDocument.open(document.export());
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.document.state()).toEqual(homeScreen());
  });

  it("keeps the fixture as the one composition, not a second copy", () => {
    expect(HOME_SCREEN_FIXTURE).toEqual(homeScreen());
  });
});
