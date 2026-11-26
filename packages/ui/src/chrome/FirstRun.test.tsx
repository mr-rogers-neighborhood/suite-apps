import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstRun, type FirstRunPack, type FirstRunTheme } from "./FirstRun.js";

const theme: FirstRunTheme = { preset: "suite", mode: "light", density: "cozy" };
const canvas: FirstRunPack = { id: "canvas", name: "Canvas" };
const planner: FirstRunPack = { id: "planner", name: "Planner" };
const packs = [canvas, planner];

function renderFirstRun(overrides: Partial<Parameters<typeof FirstRun>[0]> = {}) {
  const props = {
    packs,
    theme,
    onThemeChange: vi.fn(),
    onInstall: vi.fn(async (id: string) => ({ id, ok: true, detail: "Installed" })),
    onComplete: vi.fn(),
    ...overrides,
  };
  return { ...render(<FirstRun {...props} />), props };
}

describe("FirstRun", () => {
  afterEach(() => {
    cleanup();
  });

  it("selects every app, including one the catalogue answers after the first paint", () => {
    const { rerender } = render(
      <FirstRun
        packs={[]}
        theme={theme}
        onThemeChange={vi.fn()}
        onInstall={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByText("No apps selected")).toBeInTheDocument();

    rerender(
      <FirstRun
        packs={packs}
        theme={theme}
        onThemeChange={vi.fn()}
        onInstall={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^Canvas/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Planner/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("keeps a choice the person made when the host repaints the catalogue", () => {
    const { rerender } = renderFirstRun();
    fireEvent.click(screen.getByRole("button", { name: /^Planner/u }));

    rerender(
      <FirstRun
        packs={[...packs]}
        theme={theme}
        onThemeChange={vi.fn()}
        onInstall={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^Planner/u })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("finishes straight to Home when no app is chosen", () => {
    const { props } = renderFirstRun();
    fireEvent.click(screen.getByRole("button", { name: "Skip choosing for now" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Home" }));

    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(props.onInstall).not.toHaveBeenCalled();
  });
});
