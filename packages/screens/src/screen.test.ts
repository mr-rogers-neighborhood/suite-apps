import { describe, expect, it } from "vitest";
import {
  isScreenRow,
  parseScreen,
  type Screen,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
} from "./screen.js";

const screen: Screen = {
  format: "suite.screen",
  version: 2,
  id: "home",
  name: "Home",
  widgets: [
    { registryId: "desk.apps", size: "full" },
    {
      registryId: "planner.quick-task",
      size: "2x1",
      settings: { project: "inbox" },
    },
  ],
};

describe("the Screen shape", () => {
  it("parses and round-trips a Screen", () => {
    const parsed = parseScreen(screen);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(screen);
    expect(JSON.parse(JSON.stringify(parsed.value))).toEqual(screen);
  });

  it("retains an unknown registry id and unknown settings", () => {
    const parsed = parseScreen({
      ...screen,
      widgets: [
        {
          registryId: "future.unknown-widget",
          size: "1x1",
          settings: { "future-setting": "kept" },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.widgets[0]).toEqual({
      registryId: "future.unknown-widget",
      size: "1x1",
      settings: { "future-setting": "kept" },
    });
  });

  it("refuses a file that is not a screen", () => {
    const parsed = parseScreen({ format: "suite.start.dashboard", version: 1, widgets: [] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("corrupt");
    expect(parsed.message).toContain("not a Suite screen");
  });

  it("refuses a newer version with a sentence and never guesses", () => {
    const parsed = parseScreen({ ...screen, version: SUITE_SCREEN_VERSION + 1 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("newer");
    expect(parsed.message).toContain("newer Suite");
    expect(parsed.message).toContain("left alone");
  });

  it.each(["path", "entry", "html", "script", "document", "data", "appData"])(
    "refuses a %s field on the Screen",
    (key) => {
      expect(parseScreen({ ...screen, [key]: "/tmp/anything" }).ok).toBe(false);
    },
  );

  it.each(["src", "url", "entry", "content"])("refuses a %s field on an instance", (key) => {
    expect(
      parseScreen({
        ...screen,
        widgets: [{ registryId: "desk.apps", size: "full", [key]: "widget.js" }],
      }).ok,
    ).toBe(false);
  });

  it("refuses a settings value that is not a string", () => {
    expect(
      parseScreen({
        ...screen,
        widgets: [{ registryId: "desk.apps", size: "full", settings: { project: 7 } }],
      }).ok,
    ).toBe(false);
  });

  it("refuses a registry id that is not two lower kebab-case halves", () => {
    expect(
      parseScreen({
        ...screen,
        widgets: [{ registryId: "apps", size: "full" }],
      }).ok,
    ).toBe(false);
    expect(
      parseScreen({
        ...screen,
        widgets: [{ registryId: "desk.apps.extra", size: "full" }],
      }).ok,
    ).toBe(false);
  });

  it("refuses two instances of one registry id", () => {
    const parsed = parseScreen({
      ...screen,
      widgets: [
        { registryId: "desk.apps", size: "full" },
        { registryId: "desk.apps", size: "1x1" },
      ],
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuses an unknown size class", () => {
    expect(parseScreen({ ...screen, widgets: [{ registryId: "desk.apps", size: "3x1" }] }).ok).toBe(
      false,
    );
  });

  it("parses a row of weighted widgets and keeps its settings", () => {
    const parsed = parseScreen({
      ...screen,
      widgets: [
        {
          kind: "row",
          size: "full",
          layout: "row",
          items: [
            { registryId: "planner.quick-task", weight: 2, settings: { project: "work" } },
            { registryId: "unknown.widget", weight: 1, settings: { "future-setting": "kept" } },
          ],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = parsed.value.widgets[0];
    expect(row).toMatchObject({ kind: "row", size: "full", layout: "row" });
    if (row === undefined || !isScreenRow(row)) return;
    expect(row.items[1]).toEqual({
      registryId: "unknown.widget",
      weight: 1,
      settings: { "future-setting": "kept" },
    });
  });

  it("refuses a row that nests a row, has one item, or repeats a registry id", () => {
    expect(
      parseScreen({
        ...screen,
        widgets: [
          {
            kind: "row",
            size: "full",
            items: [
              { registryId: "desk.apps", weight: 1 },
              {
                kind: "row",
                size: "full",
                items: [
                  { registryId: "planner.quick-task", weight: 1 },
                  { registryId: "budget.month", weight: 1 },
                ],
              },
            ],
          },
        ],
      }).ok,
    ).toBe(false);

    expect(
      parseScreen({
        ...screen,
        widgets: [
          {
            kind: "row",
            size: "full",
            items: [{ registryId: "desk.apps", weight: 1 }],
          },
        ],
      }).ok,
    ).toBe(false);

    expect(
      parseScreen({
        ...screen,
        widgets: [
          {
            kind: "row",
            size: "full",
            items: [
              { registryId: "desk.apps", weight: 1 },
              { registryId: "desk.apps", weight: 1 },
            ],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("refuses a weight that is not a bounded whole number", () => {
    for (const weight of [0, 13, 1.5, "2"]) {
      expect(
        parseScreen({
          ...screen,
          widgets: [
            {
              kind: "row",
              size: "full",
              items: [
                { registryId: "desk.apps", weight },
                { registryId: "planner.quick-task", weight: 1 },
              ],
            },
          ],
        }).ok,
      ).toBe(false);
    }
  });

  it("exports the format and version it parsed", () => {
    const parsed = parseScreen(screen);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.format).toBe(SUITE_SCREEN_FORMAT);
    expect(parsed.value.version).toBe(SUITE_SCREEN_VERSION);
  });
});
