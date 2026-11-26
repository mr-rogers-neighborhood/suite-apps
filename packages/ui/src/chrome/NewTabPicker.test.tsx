import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTabPicker } from "./NewTabPicker.js";

const packs = [
  { id: "canvas", name: "Canvas", description: "Boards and cards" },
  { id: "planner", name: "Planner", description: "Plans and tasks" },
  { id: "budget", name: "Budget", description: "Envelopes and registers" },
];
const screens = [{ id: "home", name: "Home", description: "Your starting screen" }];

function renderPicker(overrides: Partial<Parameters<typeof NewTabPicker>[0]> = {}) {
  const props = {
    open: true,
    packs,
    screens,
    onClose: vi.fn(),
    onOpenPack: vi.fn(),
    onOpenScreen: vi.fn(),
    onNewScreen: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<NewTabPicker {...props} />);
  return props;
}

describe("NewTabPicker", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists packs, screens and host actions in one dialog", () => {
    renderPicker();

    expect(screen.getByRole("dialog", { name: "New tab" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Canvas/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Home/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /New screen/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Settings/u })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Packs" })).toBeInTheDocument();
  });

  it("puts focus in the search field", () => {
    renderPicker();

    expect(screen.getByRole("combobox", { name: "Search apps, screens and commands" })).toHaveFocus();
  });

  it("filters by name and description", () => {
    renderPicker();
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "plan" } });

    expect(screen.getByRole("option", { name: /Planner/u })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Canvas/u })).toBeNull();
    expect(screen.queryByRole("group", { name: "Screens" })).toBeNull();
  });

  it("moves with the arrow keys and opens the active row with Enter", () => {
    const props = renderPicker();
    const input = screen.getByRole("combobox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toContain("-option-1");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onOpenPack).toHaveBeenCalledWith("planner");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps from the last row to the first", () => {
    const props = renderPicker();
    const input = screen.getByRole("combobox");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("opens a screen and a host action on click", () => {
    const props = renderPicker();

    fireEvent.click(screen.getByRole("option", { name: /Home/u }));
    expect(props.onOpenScreen).toHaveBeenCalledWith("home");

    fireEvent.click(screen.getByRole("option", { name: /New screen/u }));
    expect(props.onNewScreen).toHaveBeenCalledTimes(1);
  });

  it("shows an unavailable pack but refuses it", () => {
    const props = renderPicker({
      packs: [{ id: "old", name: "Retired app", unavailable: true }],
      initialQuery: "retired",
    });
    const option = screen.getByRole("option", { name: /Retired app/u });

    expect(option).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(option);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(props.onOpenPack).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    renderPicker({ initialQuery: "zzzz" });

    expect(screen.getByRole("status")).toHaveTextContent("Nothing matches");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("closes on Escape", () => {
    const props = renderPicker();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
