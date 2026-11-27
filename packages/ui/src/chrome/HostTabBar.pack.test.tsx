import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostTabBar, type HostTab } from "./HostTabBar.js";
import { packMenuZones } from "./PackMenuSlots.js";

/**
 * The join between the host's one bar and the active pack's zones.
 *
 * `PackMenuSlots.test.tsx` covers the descriptors themselves. This file covers the thing
 * that makes the arrangement meaningful: the bar has exactly one strip, the pack's
 * takeover sits inside it, and the host reads nothing out of an id.
 */
const tabs: readonly HostTab[] = [{ id: "planner", title: "Planner", kind: "pack" }];

const onChoose = vi.fn();
const pack = packMenuZones(
  {
    format: "suite.menu-slots",
    title: "Autumn plan",
    navigation: [
      {
        kind: "menu",
        id: "planner.view",
        label: "View",
        items: [{ id: "planner.view.today", label: "Today", checked: true }],
      },
    ],
    actions: [{ id: "planner.export", label: "Export" }],
  },
  onChoose,
);

function renderBar(withPack: boolean) {
  return render(
    <HostTabBar
      tabs={tabs}
      activeTabId="planner"
      mark={<span>Suite</span>}
      {...(withPack ? { pack } : {})}
    />,
  );
}

describe("the host's one bar", () => {
  it("draws a single bar whether or not a pack published anything", () => {
    const { unmount } = renderBar(false);
    expect(document.querySelectorAll("header.app-bar")).toHaveLength(1);
    unmount();

    renderBar(true);
    expect(document.querySelectorAll("header.app-bar")).toHaveLength(1);
  });

  it("puts the pack's material in its own row under the host's", () => {
    renderBar(true);
    const header = screen.getByRole("banner");
    const packRow = screen.getByTestId("host-tab-bar-pack");
    expect(header).toContainElement(screen.getByRole("navigation", { name: "Open tabs" }));
    // The host's row keeps the tabs; the pack's context, takeover and actions get the
    // second, thinner row, so neither has to squeeze the other.
    expect(packRow).toContainElement(screen.getByRole("button", { name: "View" }));
    expect(packRow).toContainElement(screen.getByRole("button", { name: "Export" }));
    expect(header).not.toContainElement(screen.getByRole("button", { name: "View" }));
  });

  it("draws no pack row when the active surface published none", () => {
    renderBar(false);
    expect(screen.queryByTestId("host-tab-bar-pack")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("passes a press out unchanged for the host to forward", () => {
    renderBar(true);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onChoose).toHaveBeenCalledWith({ id: "planner.export" });
  });

  it("keeps the host's own zones whatever the pack publishes", () => {
    render(
      <HostTabBar
        tabs={tabs}
        activeTabId="planner"
        mark={<span>Suite</span>}
        sync={<span>Local only</span>}
        controls={<button type="button">Settings</button>}
        pack={pack}
      />,
    );
    const header = screen.getByRole("banner");
    // The pack cannot displace the marks at either end: that is the host's side of the
    // contract, and it is what keeps the window's own controls reachable.
    expect(header).toContainElement(screen.getByText("Suite"));
    expect(header).toContainElement(screen.getByText("Local only"));
    expect(header).toContainElement(screen.getByRole("button", { name: "Settings" }));
  });
});

describe("a pack row that does not fit", () => {
  const full = packMenuZones(
    {
      format: "suite.menu-slots",
      title: "Autumn plan",
      navigation: [
        {
          kind: "menu",
          id: "planner.view",
          label: "View",
          items: [{ id: "planner.view.today", label: "Today", checked: true }],
        },
        {
          kind: "buttons",
          id: "planner.history",
          items: [
            { id: "planner.undo", label: "Undo", glyph: "\u21b6" },
            { id: "planner.export", label: "Export" },
          ],
        },
      ],
      actions: [],
    },
    onChoose,
  );

  function renderFull() {
    onChoose.mockClear();
    return render(
      <HostTabBar tabs={tabs} activeTabId="planner" mark={<span>Suite</span>} pack={full} />,
    );
  }

  it("moves the controls after the first into a More controls menu", () => {
    renderFull();
    fireEvent.click(screen.getByRole("button", { name: "More controls" }));

    const menu = screen.getByRole("menu", { name: "More controls" });
    expect(within(menu).getByRole("menuitem", { name: /Undo/u })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Export/u })).toBeInTheDocument();
    // The first control stays inline and is not duplicated in the fold.
    expect(within(menu).queryByRole("menuitem", { name: /Today/u })).not.toBeInTheDocument();
  });

  it("sends a folded press as the pack's own id", () => {
    renderFull();
    fireEvent.click(screen.getByRole("button", { name: "More controls" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export/u }));

    expect(onChoose).toHaveBeenCalledWith({ id: "planner.export" });
  });

  it("keeps the first control inline, and Escape returns focus to the trigger", () => {
    renderFull();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More controls" }));
    fireEvent.keyDown(screen.getByRole("menu", { name: "More controls" }), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More controls" })).toHaveFocus();
  });
});
