import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTabPicker, type NewTabPack } from "./NewTabPicker.js";

const canvas: NewTabPack = {
  id: "canvas",
  name: "Canvas",
  description: "Boards and cards",
  noun: { singular: "Canvas", plural: "Canvases" },
  documents: [
    { id: "q3", name: "Q3 board", openedAt: 300 },
    { id: "reading", name: "Reading list", openedAt: 100 },
    { id: "empty", name: "An empty canvas" },
  ],
};
const help: NewTabPack = {
  id: "help",
  name: "Help",
  description: "The handbook",
};
const planner: NewTabPack = {
  id: "planner",
  name: "Planner",
  description: "Plans and tasks",
  noun: { singular: "Planner", plural: "Planners" },
  documents: [],
};
const packs = [canvas, planner, help];
const screens = [{ id: "home", name: "Home", description: "Your starting screen" }];

function renderPicker(overrides: Partial<Parameters<typeof NewTabPicker>[0]> = {}) {
  const props = {
    open: true,
    packs,
    screens,
    onClose: vi.fn(),
    onOpenPack: vi.fn(),
    onOpenDocument: vi.fn(),
    onNewDocument: vi.fn(),
    onOpenScreen: vi.fn(),
    onNewScreen: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<NewTabPicker {...props} />);
  return props;
}

function search(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

describe("NewTabPicker", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists recents, packs, Screens and host actions in one dialog", () => {
    renderPicker();

    expect(screen.getByRole("dialog", { name: "New tab" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Recents" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Packs" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Screens" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Q3 board/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Canvas/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^New screen/u })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Settings/u })).toBeInTheDocument();
  });

  it("orders recents newest first and leaves out a document that already has a tab", () => {
    renderPicker({ openDocuments: [{ packId: "canvas", documentId: "q3" }] });

    const recents = screen.getByRole("group", { name: "Recents" });
    const rows = within(recents).getAllByRole("option");
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Reading list")]);
    expect(screen.queryByRole("option", { name: /^Q3 board/u })).toBeNull();
  });

  it("puts focus in the search field", () => {
    renderPicker();

    expect(search()).toHaveFocus();
    expect(search()).toHaveAccessibleName("Search packs, Screens and documents");
  });

  it("opens a pack that declares documents at a second level and steps back", () => {
    const props = renderPicker();

    fireEvent.click(screen.getByRole("option", { name: /^Canvas/u }));

    expect(screen.getByRole("group", { name: "Recent Canvases" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Canvases" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "An empty canvas" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "New Canvas" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Screens" })).toBeNull();
    expect(props.onOpenPack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to packs" }));

    expect(screen.getByRole("group", { name: "Screens" })).toBeInTheDocument();
    expect(search()).toHaveValue("");
  });

  it("opens a document from the second level", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole("option", { name: /^Canvas/u }));
    fireEvent.click(screen.getByRole("option", { name: "An empty canvas" }));

    expect(props.onOpenDocument).toHaveBeenCalledWith("canvas", "empty");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("creates a document for the pack at the second level", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole("option", { name: /^Canvas/u }));
    fireEvent.click(screen.getByRole("option", { name: "New Canvas" }));

    expect(props.onNewDocument).toHaveBeenCalledWith("canvas");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("opens the second level for a pack that declares documents but has none yet", () => {
    renderPicker({
      packs: [
        {
          id: "fresh",
          name: "Fresh",
          noun: { singular: "Canvas", plural: "Canvases" },
          documents: [],
        },
      ],
    });

    fireEvent.click(screen.getByRole("option", { name: /^Fresh/u }));

    expect(screen.getByText("No Canvases yet.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "New Canvas" })).toBeInTheDocument();
  });

  it("opens a pack that declares no documents directly", () => {
    const props = renderPicker();

    fireEvent.click(screen.getByRole("option", { name: /^Help/u }));

    expect(props.onOpenPack).toHaveBeenCalledWith("help");
    expect(props.onClose).toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Documents" })).toBeNull();
  });

  it("finds a pack's document from the root search and opens it", () => {
    const props = renderPicker();

    fireEvent.change(search(), { target: { value: "reading" } });

    const hits = screen.getByRole("group", { name: "Documents" });
    expect(within(hits).getByRole("option", { name: /Reading list/u })).toBeInTheDocument();
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(props.onOpenDocument).toHaveBeenCalledWith("canvas", "reading");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("offers to open a file only when the host can", () => {
    renderPicker();
    expect(screen.queryByRole("option", { name: /Open a file/u })).toBeNull();

    cleanup();
    const props = renderPicker({ onOpenFile: vi.fn() });
    fireEvent.click(screen.getByRole("option", { name: /^Open a file/u }));
    expect(props.onOpenFile).toHaveBeenCalled();
  });

  it("offers to install a pack when none is installed", () => {
    const props = renderPicker({ packs: [], screens: [] });

    expect(screen.getByText(/No packs are installed yet/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /^Install a pack/u }));

    expect(props.onOpenSettings).toHaveBeenCalledWith("packs");
  });

  it("labels the second level with the pack's own nouns", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("option", { name: /^Canvas/u }));

    expect(screen.getByRole("group", { name: "Recent Canvases" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Canvases" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "New Canvas" })).toBeInTheDocument();
    expect(search()).toHaveAccessibleName("Search Canvases");
    expect(screen.getByText("New Canvas")).toBeInTheDocument();
  });

  it("moves with the arrow keys and opens the active row with Enter", () => {
    const props = renderPicker();
    fireEvent.change(search(), { target: { value: "home" } });

    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(props.onOpenScreen).toHaveBeenCalledWith("home");
  });

  it("wraps from the first row to the last", () => {
    const props = renderPicker();
    const input = search();

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it("opens a screen and a host action on click", () => {
    const props = renderPicker();

    fireEvent.click(screen.getByRole("option", { name: /^Home/u }));
    expect(props.onOpenScreen).toHaveBeenCalledWith("home");

    cleanup();
    const second = renderPicker();
    fireEvent.click(screen.getByRole("option", { name: /^New screen/u }));
    expect(second.onNewScreen).toHaveBeenCalled();
  });

  it("shows an unavailable pack but refuses it and its documents", () => {
    const props = renderPicker({
      packs: [
        ...packs,
        {
          id: "old",
          name: "Retired app",
          description: "Kept, but this build cannot draw it",
          unavailable: true,
          documents: [{ id: "one", name: "One", openedAt: 900 }],
        },
      ],
    });

    // Its document is the most recent thing on record, and still must not be offered.
    expect(screen.queryByRole("option", { name: /^One/u })).toBeNull();

    const row = screen.getByRole("option", { name: /^Retired app/u });
    expect(row).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row);
    expect(props.onOpenPack).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: /^One/u })).toBeNull();

    fireEvent.change(search(), { target: { value: "one" } });
    expect(screen.queryByRole("option", { name: /^One/u })).toBeNull();
  });

  it("says when nothing matches", () => {
    renderPicker();
    fireEvent.change(search(), { target: { value: "zzzz" } });

    expect(screen.getByRole("status")).toHaveTextContent("Nothing matches “zzzz”.");
  });

  it("steps back on Escape inside a pack, and closes on Escape at the root", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole("option", { name: /^Canvas/u }));

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.getByRole("group", { name: "Packs" })).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("clears a query before it steps back or closes", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole("option", { name: /^Canvas/u }));
    fireEvent.change(search(), { target: { value: "reading" } });

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search()).toHaveValue("");
    expect(screen.getByRole("group", { name: "Recent Canvases" })).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.getByRole("group", { name: "Packs" })).toBeInTheDocument();

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("skips an unavailable row when moving with the keyboard", () => {
    renderPicker({
      packs: [
        canvas,
        {
          id: "old",
          name: "Retired app",
          unavailable: true,
          documents: [{ id: "one", name: "One" }],
        },
        help,
      ],
    });
    const input = search();

    fireEvent.keyDown(input, { key: "End" });

    const settings = screen.getByRole("option", { name: /^Settings/u });
    expect(input.getAttribute("aria-activedescendant")).toBe(settings.id);
  });

  it("steps back on Backspace when the query is empty", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("option", { name: /^Canvas/u }));

    fireEvent.keyDown(search(), { key: "Backspace" });

    expect(screen.getByRole("group", { name: "Recents" })).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const props = renderPicker();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "New tab" }), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalled();
  });
});
