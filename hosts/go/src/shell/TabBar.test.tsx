import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TabBar } from "./TabBar.js";

describe("the tab strip", () => {
  it("names the current app, counts the open tabs and offers the catalogue", () => {
    const html = renderToString(
      <TabBar
        tabs={[
          { id: "planner", name: "Planner" },
          { id: "budget", name: "Budget" },
        ]}
        activeId="budget"
        onFocus={vi.fn()}
        onClose={vi.fn()}
        onHome={vi.fn()}
        onCatalogue={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Current app: Budget. 2 open. Open tabs"');
    expect(html).toContain('aria-hidden="true">2</span>');
    expect(html).toContain('aria-label="Open an app from the catalogue"');
    expect(html).toContain("Home");
  });

  it("shows the open-apps cell when Home is showing", () => {
    const html = renderToString(
      <TabBar
        tabs={[]}
        activeId={null}
        onFocus={vi.fn()}
        onClose={vi.fn()}
        onHome={vi.fn()}
        onCatalogue={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="0 open apps"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Home");
  });
});
