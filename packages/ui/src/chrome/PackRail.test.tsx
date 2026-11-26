import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PackRail, type PackRailPack } from "./PackRail.js";

const pack: PackRailPack = {
  name: "Canvas",
  description: "Boards, cards and the book reader",
  status: "Installed · 0.4.3",
  primary: { label: "Open Canvas", onSelect: () => {} },
  actions: [{ label: "Show in folder", onSelect: () => {} }],
  screenshots: [{ src: "data:image/svg+xml,%3Csvg/%3E", alt: "A board with cards" }],
  details: [
    { label: "Version", value: "0.4.3" },
    { label: "Publisher", value: "suite" },
  ],
};

afterEach(() => {
  cleanup();
});

describe("PackRail", () => {
  it("shows the pack's page, with the technical record behind one disclosure", () => {
    render(<PackRail pack={pack} onClose={() => {}} />);

    expect(screen.getByRole("complementary", { name: "Canvas details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Canvas" })).toBeInTheDocument();
    expect(screen.getByText("Installed · 0.4.3")).toBeInTheDocument();
    expect(screen.getByText("Boards, cards and the book reader")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A board with cards" })).toBeInTheDocument();

    // The details are present but collapsed: the face of the rail never reads like an audit log.
    const disclosure = screen.getByText("More details").closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("suite")).toBeInTheDocument();
  });

  it("runs the one action and the secondary ones", () => {
    const open = vi.fn();
    const reveal = vi.fn();
    render(
      <PackRail
        pack={{
          ...pack,
          primary: { label: "Open Canvas", onSelect: open },
          actions: [{ label: "Show in folder", onSelect: reveal }],
        }}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Canvas" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));

    expect(open).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it("closes", () => {
    const onClose = vi.fn();
    render(<PackRail pack={pack} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close details" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("refuses the action and says why when the build cannot draw the pack", () => {
    render(
      <PackRail
        pack={{
          ...pack,
          note: "This build cannot open Canvas.",
          primary: { label: "Install", onSelect: () => {}, disabled: true },
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("This build cannot open Canvas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeDisabled();
  });

  it("renders nothing when nothing is chosen", () => {
    const { container } = render(<PackRail pack={null} onClose={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });
});
