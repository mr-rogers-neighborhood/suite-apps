import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell.js";

describe("AppShell", () => {
  it("renders the title as the page heading", () => {
    render(<AppShell title="Household">Content</AppShell>);
    expect(screen.getByRole("heading", { level: 1, name: "Household" })).toBeInTheDocument();
  });

  it("takes a leading control and trailing actions as nodes", () => {
    render(
      <AppShell
        title="Household"
        leading={<button type="button">Back</button>}
        actions={<button type="button">New account</button>}
      >
        Content
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New account" })).toBeInTheDocument();
  });

  it("renders the content in the main region", () => {
    render(
      <AppShell title="Household">
        <p>Pack content</p>
      </AppShell>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("Pack content");
  });

  it("names the navigation landmark, with a default", () => {
    render(
      <AppShell title="Household" navigation={<a href="#accounts">Accounts</a>}>
        Content
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Navigation" });
    expect(nav).toHaveTextContent("Accounts");
    expect(screen.getByRole("link", { name: "Accounts" })).toBeInTheDocument();
  });

  it("lets a caller name the navigation", () => {
    render(
      <AppShell title="Household" navigationLabel="Sections" navigation={<span>Sections</span>}>
        Content
      </AppShell>,
    );
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
  });

  it("omits the navigation landmark when there is no navigation slot", () => {
    render(<AppShell title="Household">Content</AppShell>);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("marks the frame when it has navigation", () => {
    const { container, rerender } = render(<AppShell title="Household">Content</AppShell>);
    expect(container.firstElementChild).not.toHaveAttribute("data-has-navigation");

    rerender(
      <AppShell title="Household" navigation={<span>Accounts</span>}>
        Content
      </AppShell>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-has-navigation", "true");
  });

  it("keeps a caller's class alongside its own", () => {
    const { container } = render(
      <AppShell title="Household" className="min-h-screen">
        Content
      </AppShell>,
    );
    expect(container.firstElementChild?.className).toContain("min-h-screen");
  });

  it("takes a caller's bar in place of the default title header", () => {
    render(
      <AppShell
        header={
          <header aria-label="Menu bar">
            <span>Suite Planner</span>
          </header>
        }
      >
        Content
      </AppShell>,
    );

    expect(screen.getByRole("banner", { name: "Menu bar" })).toHaveTextContent("Suite Planner");
    // The caller's bar owns the heading order; the shell adds no page heading of its own.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("marks the frame when a caller supplies its own bar", () => {
    const { container } = render(
      <AppShell header={<header aria-label="Menu bar">Bar</header>}>Content</AppShell>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-has-header", "custom");
  });

  it("lets a caller paint the navigation landmark", () => {
    render(
      <AppShell
        title="Household"
        navigation={<span>Accounts</span>}
        navigationClassName="bg-[var(--surface)]"
      >
        Content
      </AppShell>,
    );
    expect(screen.getByRole("navigation", { name: "Navigation" })).toHaveClass(
      "bg-[var(--surface)]",
    );
  });
});
