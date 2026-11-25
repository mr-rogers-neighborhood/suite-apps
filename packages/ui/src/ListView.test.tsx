import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState.js";
import { ListView, type ListViewItem } from "./ListView.js";

const ROWS: readonly ListViewItem[] = [
  { id: "one", content: "One" },
  { id: "two", content: "Two" },
  { id: "three", content: "Three" },
];

function renderList(overrides: Partial<Parameters<typeof ListView>[0]> = {}) {
  return render(<ListView label="Accounts" items={ROWS} selectedId={null} {...overrides} />);
}

describe("ListView", () => {
  it("is a named listbox with one option per row", () => {
    renderList();
    expect(screen.getByRole("listbox", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "One" })).toBeInTheDocument();
  });

  it("marks the selected row and gives it the roving tab stop", () => {
    renderList({ selectedId: "two" });
    const selected = screen.getByRole("option", { name: "Two" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveAttribute("data-selected", "true");
    expect(selected).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("option", { name: "One" })).toHaveAttribute("tabindex", "-1");
  });

  it("falls back to the first enabled row for the tab stop", () => {
    renderList({ selectedId: "missing" });
    expect(screen.getByRole("option", { name: "One" })).toHaveAttribute("tabindex", "0");
  });

  it("selects a row on click", () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    fireEvent.click(screen.getByRole("option", { name: "Three" }));
    expect(onSelect).toHaveBeenCalledWith("three");
  });

  it("selects the next row with ArrowDown and moves focus", () => {
    const onSelect = vi.fn();
    renderList({ selectedId: "one", onSelect });
    fireEvent.keyDown(screen.getByRole("option", { name: "One" }), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("two");
    expect(screen.getByRole("option", { name: "Two" })).toHaveFocus();
  });

  it("wraps with ArrowUp and ArrowDown", () => {
    const onSelect = vi.fn();
    renderList({ onSelect });

    fireEvent.keyDown(screen.getByRole("option", { name: "One" }), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenLastCalledWith("three");
    expect(screen.getByRole("option", { name: "Three" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("option", { name: "Three" }), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("one");
    expect(screen.getByRole("option", { name: "One" })).toHaveFocus();
  });

  it("jumps to the ends with Home and End", () => {
    renderList();
    fireEvent.keyDown(screen.getByRole("option", { name: "Two" }), { key: "Home" });
    expect(screen.getByRole("option", { name: "One" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("option", { name: "One" }), { key: "End" });
    expect(screen.getByRole("option", { name: "Three" })).toHaveFocus();
  });

  it("opens the focused row with Enter", () => {
    const onActivate = vi.fn();
    renderList({ onActivate });
    fireEvent.keyDown(screen.getByRole("option", { name: "Two" }), { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith("two");
  });

  it("selects the focused row with Space", () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    fireEvent.keyDown(screen.getByRole("option", { name: "Two" }), { key: " " });
    expect(onSelect).toHaveBeenCalledWith("two");
  });

  it("skips disabled rows in traversal and on click", () => {
    const onSelect = vi.fn();
    render(
      <ListView
        label="Accounts"
        selectedId={null}
        onSelect={onSelect}
        items={[
          { id: "one", content: "One" },
          { id: "two", content: "Two", disabled: true },
          { id: "three", content: "Three" },
        ]}
      />,
    );

    const disabled = screen.getByRole("option", { name: "Two" });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).toHaveAttribute("tabindex", "-1");

    fireEvent.click(disabled);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("option", { name: "One" }), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Three" })).toHaveFocus();
  });

  it("groups rows under named sections", () => {
    render(
      <ListView
        label="Categories"
        selectedId="groceries"
        sections={[
          {
            id: "this-month",
            title: "This month",
            items: [
              { id: "groceries", content: "Groceries" },
              { id: "transport", content: "Transport" },
            ],
          },
          {
            id: "last-month",
            title: "Last month",
            items: [{ id: "rent", content: "Rent" }],
          },
        ]}
      />,
    );

    expect(screen.getByRole("group", { name: "This month" })).toHaveTextContent("Groceries");
    expect(screen.getByRole("group", { name: "Last month" })).toHaveTextContent("Rent");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("renders the shared empty state instead of an empty listbox", () => {
    render(<ListView label="Accounts" items={[]} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("lets a caller replace the empty state", () => {
    render(
      <ListView
        label="Accounts"
        items={[]}
        empty={<EmptyState title="No accounts yet">Add one to begin.</EmptyState>}
      />,
    );
    expect(screen.getByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByText("Add one to begin.")).toBeInTheDocument();
  });

  it("keeps a caller's class alongside its own", () => {
    renderList({ className: "max-w-md" });
    expect(screen.getByRole("listbox").className).toContain("max-w-md");
  });
});
