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
});
