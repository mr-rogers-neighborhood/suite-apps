import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostTabBar, type HostTab } from "./HostTabBar.js";

const tabs: HostTab[] = [
  { id: "canvas", title: "Canvas", kind: "pack" },
  { id: "planner", title: "Planner", kind: "pack" },
  { id: "home", title: "Home", kind: "screen" },
];

function renderBar(overrides: Partial<Parameters<typeof HostTabBar>[0]> = {}) {
  return render(
    <HostTabBar
      tabs={tabs}
      activeTabId="canvas"
      onActivate={() => {}}
      onClose={() => {}}
      onNewTab={() => {}}
      {...overrides}
    />,
  );
}

describe("HostTabBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one open-tabs landmark and marks the current tab", () => {
    renderBar();

    expect(screen.getByRole("navigation", { name: "Open tabs" })).toBeInTheDocument();
    const canvas = screen.getByRole("button", { name: "Canvas" });
    expect(canvas).toHaveAttribute("aria-current", "page");
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Planner" })).not.toHaveAttribute("aria-current");
  });

  it("activates a tab on click", () => {
    const onActivate = vi.fn();
    renderBar({ onActivate });

    fireEvent.click(screen.getByRole("button", { name: "Planner" }));

    expect(onActivate).toHaveBeenCalledWith("planner");
  });

  it("keeps the active tab in view when it is chosen from outside the strip", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    renderBar({ activeTabId: "home" });

    // The host changes `activeTabId` itself when a document opens, so the strip has to
    // bring the newly chosen tab into view rather than leave it scrolled off the edge.
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      screen.getByRole("button", { name: "Home" }),
    );
    scrollIntoView.mockRestore();
  });

  it("moves and activates with the arrow keys, wrapping at the ends", () => {
    const onActivate = vi.fn();
    renderBar({ onActivate });

    const canvas = screen.getByRole("button", { name: "Canvas" });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onActivate).toHaveBeenLastCalledWith("planner");
    expect(screen.getByRole("button", { name: "Planner" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Planner" }), { key: "ArrowLeft" });
    expect(onActivate).toHaveBeenLastCalledWith("canvas");

    fireEvent.keyDown(screen.getByRole("button", { name: "Canvas" }), { key: "ArrowLeft" });
    expect(onActivate).toHaveBeenLastCalledWith("home");
  });

  it("jumps to the first and last tab with Home and End", () => {
    const onActivate = vi.fn();
    renderBar({ onActivate });
    const canvas = screen.getByRole("button", { name: "Canvas" });

    fireEvent.keyDown(canvas, { key: "End" });
    expect(onActivate).toHaveBeenLastCalledWith("home");

    fireEvent.keyDown(screen.getByRole("button", { name: "Home" }), { key: "Home" });
    expect(onActivate).toHaveBeenLastCalledWith("canvas");
  });

  it("closes without activating when the close button is used", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    renderBar({ onActivate, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close Planner" }));

    expect(onClose).toHaveBeenCalledWith("planner");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("closes the focused tab with Delete", () => {
    const onClose = vi.fn();
    renderBar({ onClose });

    fireEvent.keyDown(screen.getByRole("button", { name: "Planner" }), { key: "Delete" });

    expect(onClose).toHaveBeenCalledWith("planner");
  });

  it("opens a tab menu from the context menu or the keyboard", () => {
    const onTabMenu = vi.fn();
    renderBar({ onTabMenu });
    const home = screen.getByRole("button", { name: "Home" });

    fireEvent.contextMenu(home);
    expect(onTabMenu).toHaveBeenLastCalledWith("home");

    fireEvent.keyDown(home, { key: "F10", shiftKey: true });
    expect(onTabMenu).toHaveBeenCalledTimes(2);
  });

  it("opens a new tab and the command surface", () => {
    const onNewTab = vi.fn();
    const onOpenSearch = vi.fn();
    renderBar({ onNewTab, onOpenSearch });

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(onNewTab).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Search or jump to/u }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("says when no tab is open", () => {
    renderBar({ tabs: [], onClose: undefined });

    expect(screen.getByText("No open tabs")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Open tabs" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New tab" })).toBeInTheDocument();
  });

  it("marks an unavailable tab without removing it", () => {
    renderBar({
      tabs: [{ id: "gap", title: "Retired app", kind: "pack", unavailable: true }],
      activeTabId: "gap",
    });

    expect(screen.getByRole("button", { name: "Retired app" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Close Retired app" })).toBeInTheDocument();
  });
});

describe("the tab switch list", () => {
  const openSwitch = () => fireEvent.click(screen.getByRole("button", { name: "All tabs" }));

  it("lists every open tab and marks the one in front", () => {
    renderBar();
    openSwitch();

    const menu = screen.getByRole("menu", { name: "All tabs" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3);
    expect(within(menu).getByRole("menuitemradio", { name: /Canvas/u })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(menu).getByRole("menuitemradio", { name: /Planner/u })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("activates the chosen tab and returns focus to the trigger", () => {
    const onActivate = vi.fn();
    renderBar({ onActivate });
    openSwitch();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Home/u }));

    expect(onActivate).toHaveBeenCalledWith("home");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All tabs" })).toHaveFocus();
  });

  it("closes on Escape and hands focus back", () => {
    renderBar();
    openSwitch();

    fireEvent.keyDown(screen.getByRole("menu", { name: "All tabs" }), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All tabs" })).toHaveFocus();
  });

  it("is absent when there is only one tab", () => {
    renderBar({ tabs: [tabs[0]!], activeTabId: "canvas" });
    expect(screen.queryByRole("button", { name: "All tabs" })).not.toBeInTheDocument();
  });
});
