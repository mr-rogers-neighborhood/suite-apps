import { describe, expect, it } from "vitest";
import { ScreenDocument } from "./document.js";
import { HOME_SCREEN_FIXTURE, homeScreen, homeScreenDocument } from "./fixture.js";

describe("the shared Home fixture", () => {
  it("is a valid Screen", () => {
    expect(homeScreen().id).toBe("home");
    expect(homeScreen().widgets.map((widget) => widget.registryId)).toEqual([
      "shell.apps",
      "planner.quick-task",
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
