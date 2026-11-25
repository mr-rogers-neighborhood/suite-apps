import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactRouterProvider } from "fumadocs-core/framework/react-router";
import { StrictMode } from "react";
import { HashRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { sources } from "@/lib/source";

/**
 * The handbook pages travel inside the pack, in two sections.
 *
 * `pnpm --dir legacy/help sync` writes `.generated/docs`, and `fumadocs-mdx/vite`
 * compiles every page into the bundle; this is the test that the archive has
 * pages, not only the explorer's index JSON. The generated audience index says
 * which page opens where, so the stub below is the smallest one that proves the
 * split: one developer page, one user page and the developer root.
 */
const docsIndex = {
  version: 1,
  pages: [
    { path: "docs/README.md", slug: "", audience: "developer" },
    {
      path: "docs/reference/pack-authoring.md",
      slug: "reference/pack-authoring",
      audience: "developer",
    },
    {
      path: "docs/tutorials/01-install.md",
      slug: "tutorials/01-install",
      audience: "user",
    },
  ],
};

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      if (url.endsWith("/data/docs.json")) return json(docsIndex);
      if (url.endsWith("/data/handbook-search.json")) return json([]);
      return { ok: false, status: 404, json: async () => null } as Response;
    }),
  );
}

function renderAt(hash: string) {
  window.history.replaceState(null, "", hash);
  stubFetch();
  render(
    <StrictMode>
      <HashRouter>
        <ReactRouterProvider>
          <App />
        </ReactRouterProvider>
      </HashRouter>
    </StrictMode>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#/explore");
});

describe("Help's bundled handbook", () => {
  it("keeps both sections over one generated tree", () => {
    expect(sources.developer.getPageTree().children.length).toBeGreaterThan(0);

    const developer = sources.developer.getPage(["reference", "pack-authoring"]);
    expect(developer?.data.title).toBe("Pack authoring");
    expect(developer?.data.body).toBeTruthy();

    const user = sources.user.getPage(["tutorials", "01-install"]);
    expect(user?.data.title).toBe("1. Install the desktop apps");
  });

  it("renders a developer page with the way back to the handbook", async () => {
    renderAt("#/developer/reference/pack-authoring");

    expect(await screen.findByRole("heading", { name: "Pack authoring", level: 1 })).toBeTruthy();
    // The reader's own navigator is present, so this is the reader and not the explorer's pane.
    expect(screen.getByRole("complementary", { name: "Handbook contents" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: /View the user handbook/u }));
    await waitFor(() => expect(window.location.hash).toBe("#/handbook"));
  });

  it("opens the user handbook by default and offers the developer documentation", async () => {
    renderAt("#/handbook");

    expect(await screen.findByRole("heading", { name: "User handbook", level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /Switch to the developer documentation/u }));
    await waitFor(() => expect(window.location.hash).toBe("#/developer"));
  });

  it("takes an old handbook link to the section the page now belongs to", async () => {
    renderAt("#/handbook/reference/pack-authoring");

    await waitFor(() => expect(window.location.hash).toBe("#/developer/reference/pack-authoring"));
    expect(await screen.findByRole("heading", { name: "Pack authoring", level: 1 })).toBeTruthy();
  });
});
