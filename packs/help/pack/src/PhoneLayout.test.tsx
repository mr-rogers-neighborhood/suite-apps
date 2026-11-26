import { fireEvent, render, screen } from "@testing-library/react";
import { ReactRouterProvider } from "fumadocs-core/framework/react-router";
import { StrictMode } from "react";
import { HashRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { baseData, responses } from "./test/fixtures";

/**
 * The explorer at phone width.
 *
 * Below `md` the shared `AppShell` would stack its navigation above the document, which
 * spends the top half of a phone on a rail. The explorer keeps the shell for the frame and
 * puts the navigator in a drawer instead; this is the proof that the drawer is reachable
 * from the header and closes again without leaving the document.
 */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function stubViewport(wide: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width: 768px") ? wide : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function renderExplorer(): void {
  window.history.replaceState(null, "", "#/explore");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const body =
        responses.get(url) ?? responses.get(new URL(url, "https://pack.invalid").pathname);
      return body === undefined
        ? ({ ok: false, status: 404, json: async () => null } as Response)
        : jsonResponse(body);
    }),
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
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Help at phone width", () => {
  it("draws the shared app frame and opens the navigator as a drawer", async () => {
    stubViewport(false);
    renderExplorer();

    expect(await screen.findByText(baseData.tours[0]?.intro ?? "")).toBeTruthy();
    // The shared `AppShell` owns the page's one h1 and its header landmark.
    expect(screen.getByRole("heading", { level: 1, name: "Suite Help" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Code navigator" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigator" }));

    expect(screen.getByRole("complementary", { name: "Code navigator" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Search files, symbols and tours…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close navigator" }));

    expect(screen.queryByRole("complementary", { name: "Code navigator" })).toBeNull();
  });

  it("keeps the desktop navigator in the shell above the drawer breakpoint", async () => {
    stubViewport(true);
    renderExplorer();

    expect(await screen.findByText(baseData.tours[0]?.intro ?? "")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Code navigator" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Toggle navigator" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Modules" }));

    expect(await screen.findByRole("listbox", { name: "Modules" })).toBeTruthy();
  });
});
