import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("does not preselect an app the host already reports as installed", () => {
    renderFirstRun({ packs: [canvas, { ...planner, status: "installed" }] });

    expect(screen.getByRole("button", { name: /^Planner/u })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();
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

  it("shows a refused install and retries only the failed app", async () => {
    const onInstall = vi.fn(async (id: string) =>
      id === "planner"
        ? { id, ok: false, detail: "Signature refused" }
        : { id, ok: true, detail: "Installed" },
    );
    renderFirstRun({ onInstall });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Install 2 apps" }));

    await screen.findByText("Signature refused");
    expect(onInstall).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(3));
    expect(onInstall).toHaveBeenLastCalledWith("planner");
  });

  it("uses the install tiles and the real action as the theme preview", () => {
    renderFirstRun();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "What this installs" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Install 2 apps" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
    const tile = screen.getByText("Canvas").closest("li");
    expect(tile?.className).toContain("--control-padding-x");
  });

  it("keeps follow-the-system as a choice and sends it to the host", () => {
    const onThemeChange = vi.fn();
    renderFirstRun({ onThemeChange });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Follow the system" }));

    expect(onThemeChange).toHaveBeenCalledWith({
      preset: "suite",
      mode: "system",
      density: "cozy",
    });
  });

  it("keeps follow-the-system when another appearance choice changes", () => {
    const onThemeChange = vi.fn();
    renderFirstRun({
      theme: { preset: "suite", mode: "system", density: "cozy" },
      onThemeChange,
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));

    expect(onThemeChange).toHaveBeenCalledWith({
      preset: "suite",
      mode: "system",
      density: "compact",
    });
  });

  it("shows a completion failure instead of leaving the wizard silent", async () => {
    const onComplete = vi.fn(() => Promise.reject(new Error("The data root is read-only.")));
    renderFirstRun({ onComplete });

    fireEvent.click(screen.getByRole("button", { name: "Skip choosing for now" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Home" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("read-only");
  });
});
