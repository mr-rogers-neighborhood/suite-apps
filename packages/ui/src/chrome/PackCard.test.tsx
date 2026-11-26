import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PackCard } from "./PackCard.js";

afterEach(() => {
  cleanup();
});

describe("PackCard", () => {
  it("shows the mark, name, sentence and state, not the technical record", () => {
    render(
      <PackCard
        name="Canvas"
        description="Boards, cards and the book reader"
        icon="data:image/svg+xml,%3Csvg/%3E"
        status="installed"
        version="0.4.3"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /Canvas/u })).toBeInTheDocument();
    expect(screen.getByText("Boards, cards and the book reader")).toBeInTheDocument();
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText("0.4.3")).toBeInTheDocument();
  });

  it("chooses the pack when pressed", () => {
    const onSelect = vi.fn();
    render(<PackCard name="Planner" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /Planner/u }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Planner/u })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks the card whose details are showing", () => {
    render(<PackCard name="Budget" selected onSelect={() => {}} />);

    expect(screen.getByRole("button", { name: /Budget/u })).toHaveAttribute("aria-pressed", "true");
  });

  it("draws the initial when a pack has no artwork", () => {
    render(<PackCard name="notes" onSelect={() => {}} />);

    expect(screen.getByText("N")).toBeInTheDocument();
  });
});
