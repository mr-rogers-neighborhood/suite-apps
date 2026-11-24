import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactRouterProvider } from "fumadocs-core/framework/react-router";
import { StrictMode } from "react";
import { HashRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { source } from "@/lib/source";

/**
 * The handbook pages travel inside the pack.
 *
 * `pnpm --dir apps/help sync` writes `.generated/docs`, and `fumadocs-mdx/vite` compiles every page
 * into the bundle; this is the test that the archive has pages, not only the explorer's index JSON.
 * The route is the one the desktop app uses, reached through the pack's hash router.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#/explore");
});

describe("Help's bundled handbook", () => {
  it("loads a generated page and its page tree from the bundle", () => {
    const tree = source.getPageTree();
    expect(tree.children.length).toBeGreaterThan(0);

    const page = source.getPage(["reference", "pack-authoring"]);
    expect(page?.data.title).toBe("Pack authoring");
    expect(page?.data.body).toBeTruthy();
  });

  it("renders a handbook page at its pack route", async () => {
    window.history.replaceState(null, "", "#/handbook/reference/pack-authoring");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => null }) as Response),
    );

    render(
      <StrictMode>
        <HashRouter>
          <ReactRouterProvider>
            <App />
          </ReactRouterProvider>
        </HashRouter>
      </StrictMode>,
    );

    expect(await screen.findByRole("heading", { name: "Pack authoring", level: 1 })).toBeTruthy();
    // The handbook's own navigator is present, so this is the reader and not the explorer's pane.
    expect(screen.getByRole("complementary", { name: "Handbook contents" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Explorer" }));
    await waitFor(() => expect(window.location.hash.startsWith("#/explore")).toBe(true));
  });
});
