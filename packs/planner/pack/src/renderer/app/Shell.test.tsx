import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../store/uiStore";
import type { ViewId } from "./views";

// The shell's calendar and the rail's workspace line are the only machine dependencies here.
vi.mock("../calendar/DayCalendar", () => ({
  DayCalendar: () => <aside aria-label="Calendar" />,
}));

vi.mock("../platform/bridge", () => ({
  getBridge: () => ({ info: async () => ({ path: "/tmp/workspace.planner" }) }),
}));

// Extend the real registry with a view this build does not ship. The shell should reach it without
// a branch, which is what makes a new surface a registry entry and nothing else.
vi.mock("./views", async () => {
  const actual = await vi.importActual<typeof import("./views")>("./views");
  const Icon = () => null;
  const Today = () => <section aria-label="Day plan" />;
  const InboxPane = () => <section aria-label="Inbox" />;
  const Probe = () => <section aria-label="Probe view" />;
  return {
    ...actual,
    views: {
      today: { id: "today", label: "Today", icon: Icon, component: Today },
      inbox: { id: "inbox", label: "Inbox", icon: Icon, component: InboxPane },
      probe: { id: "probe", label: "Probe", icon: Icon, component: Probe },
    },
  };
});

const { Shell } = await import("./Shell");

function showView(id: string): void {
  useUiStore.setState({ view: id as unknown as ViewId });
}

function rail(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

function stubWide(wide: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

describe("Shell navigation", () => {
  beforeEach(() => {
    useUiStore.setState({ view: "today", selectedDate: "2026-11-20" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("should render a view added to the registry without a shell branch", () => {
    showView("probe");

    render(<Shell />);

    expect(screen.getByRole("region", { name: "Probe view" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("region", { name: "Probe view" }),
    );
  });

  it("should put the rail in the shared frame's navigation landmark", () => {
    render(<Shell />);

    expect(within(rail()).getByRole("listbox", { name: "Views" })).toBeInTheDocument();
    expect(within(rail()).getAllByRole("option")).toHaveLength(3);
  });

  it("should omit the desktop rail below the breakpoint and keep the drawer", () => {
    stubWide(false);
    render(<Shell />);

    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Day plan" })).toBeInTheDocument();
  });

  it("should mark the rail entry for the active view", () => {
    showView("probe");

    render(<Shell />);

    expect(within(rail()).getByRole("option", { name: "Probe" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(rail()).getByRole("option", { name: "Today" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("should open today when the stored view is not registered", () => {
    showView("archived-view");

    render(<Shell />);

    expect(screen.getByRole("region", { name: "Day plan" })).toBeInTheDocument();
  });

  it("should switch views from the rail's listbox", async () => {
    const user = userEvent.setup();
    render(<Shell />);

    await user.click(within(rail()).getByRole("option", { name: "Probe" }));

    expect(await screen.findByRole("region", { name: "Probe view" })).toBeInTheDocument();
    expect(within(rail()).getByRole("option", { name: "Probe" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("should open and close the mobile drawer from its named button", async () => {
    render(<Shell />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog", { name: "Navigation" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
  });

  it("should offer the registered views from the bar without leaving the rail", async () => {
    render(<Shell />);

    const trigger = screen.getByRole("button", { name: "Switch view (Today)" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByText("Inbox")).toBeInTheDocument();
    expect(within(menu).getByText("Probe")).toBeInTheDocument();

    fireEvent.click(within(menu).getByText("Probe"));

    expect(await screen.findByRole("region", { name: "Probe view" })).toBeInTheDocument();
    expect(within(rail()).getByRole("option", { name: "Probe" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("should trap focus in the drawer and give it back to the opener", async () => {
    const user = userEvent.setup();
    render(<Shell />);

    const opener = screen.getByRole("button", { name: "Open navigation" });
    opener.focus();
    await user.click(opener);

    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    const close = within(drawer).getByRole("button", { name: "Close navigation" });

    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(within(drawer).getByRole("button", { name: "Import" })).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("should close the drawer after a destination and return focus to the opener", async () => {
    const user = userEvent.setup();
    render(<Shell />);

    const opener = screen.getByRole("button", { name: "Open navigation" });
    opener.focus();
    await user.click(opener);

    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    await user.click(within(drawer).getByRole("option", { name: "Probe" }));

    expect(await screen.findByRole("region", { name: "Probe view" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("should keep sync in the phone bar and the drawer's views reachable", async () => {
    render(<Shell />);

    const sync = await screen.findByTestId("sync-status");
    expect(sync.className).not.toMatch(/\bhidden\b/u);
    expect(sync).toHaveClass("touch");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("listbox", { name: "Views" })).toBeInTheDocument();
    expect(within(drawer).getByRole("option", { name: "Today" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
