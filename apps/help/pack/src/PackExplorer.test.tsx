import { fireEvent, render, screen } from "@testing-library/react";
import { ReactRouterProvider } from "fumadocs-core/framework/react-router";
import { StrictMode } from "react";
import { HashRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { baseData, responses } from "./test/fixtures";

/**
 * The pack's entry, mounted over the generated-index shape.
 *
 * The host serves the built page from `suite-pack://<container>.help/index.html`; Help's pack entry
 * chooses `HashRouter` so every view is a hash change inside that one file. This test is that
 * entry's routing proof: the explorer loads its five data files, and Browser, Modules and Tours all
 * open without a repository checkout or a server.
 */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function renderPack() {
  return render(
    <StrictMode>
      <HashRouter>
        <ReactRouterProvider>
          <App />
        </ReactRouterProvider>
      </HashRouter>
    </StrictMode>,
  );
}

beforeEach(() => {
  // The host opens `suite-pack://<container>.help/index.html` with no hash. HashRouter starts at
  // `/`, the app redirects to `/explore`, and the address bar gains the hash from there.
  window.history.replaceState(null, "", "/");
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Help as a pack", () => {
  it("opens on the tours index from the bundled data", async () => {
    renderPack();

    expect(await screen.findByText(baseData.tours[0]?.intro ?? "")).toBeTruthy();
    expect(screen.getAllByText("Start here").length).toBeGreaterThan(0);
    expect(window.location.hash.startsWith("#/explore")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("The first file.")).toBeTruthy();
  });

  it("switches to Modules and opens a module from the same index", async () => {
    renderPack();
    await screen.findByText(baseData.tours[0]?.intro ?? "");

    fireEvent.click(screen.getByRole("button", { name: "Modules" }));
    fireEvent.click(await screen.findByRole("button", { name: /apps\/help/u }));

    expect(await screen.findByText("The documentation reader.")).toBeTruthy();
    expect(screen.getByText("The explorer is the structure.")).toBeTruthy();
  });

  it("switches to Browser and shows the tree without a fetch outside its bundle", async () => {
    renderPack();
    await screen.findByText(baseData.tours[0]?.intro ?? "");

    fireEvent.click(screen.getByRole("button", { name: "Browser" }));
    fireEvent.click(await screen.findByRole("button", { name: "help" }));

    expect(await screen.findByRole("button", { name: /example\.ts/u })).toBeTruthy();
    for (const url of vi.mocked(fetch).mock.calls.map(([input]) => String(input))) {
      expect(url.startsWith("/data/")).toBe(true);
    }
  });
});
