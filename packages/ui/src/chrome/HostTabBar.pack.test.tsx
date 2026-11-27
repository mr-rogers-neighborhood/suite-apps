import { fireEvent, render, screen } from "@testing-library/react";
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
