import { act, fireEvent, render, screen } from "@testing-library/react";
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
 * entry's routing proof: the explorer loads its six data files, and Browser, Modules and Tours all
 * open without a repository checkout or a server.
 */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function renderPack(hash = "#/explore") {
  window.history.replaceState(null, "", hash);
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
  // The host opens `suite-pack://<container>.help/index.html`; each test names the route it
  // exercises. A pack with no hash opens the user handbook, which the last test covers.
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
  delete (window as unknown as { suite?: unknown }).suite;
});

describe("Help as a pack", () => {
  it("opens the user handbook by default, with the switch to the developer docs", async () => {
    renderPack("/");

    expect(await screen.findByRole("heading", { name: "User handbook", level: 1 })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Switch to the developer documentation/u }),
    ).toBeTruthy();
    expect(window.location.hash.startsWith("#/handbook")).toBe(true);
  });

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
    // The page list is the shared listbox, so a module is an option rather than a button.
    fireEvent.click(await screen.findByRole("option", { name: /legacy\/help/u }));

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

interface StubSlots {
  title: string | null;
  navigation: Array<
    | { kind: "menu"; id: string; items: Array<{ id: string }> }
    | { kind: "toggle"; id: string }
  >;
}

function stubHostBar() {
  const setSlots = vi.fn<(slots: StubSlots) => void>();
  const listeners: Array<(action: { id: string; item?: string }) => void> = [];
  (window as unknown as { suite?: unknown }).suite = {
    menuBar: {
      setSlots,
      onAction: (listener: (action: { id: string; item?: string }) => void) => {
        listeners.push(listener);
        return () => {};
      },
    },
  };
  return {
    setSlots,
    send: async (action: { id: string; item?: string }) => {
      await act(async () => {
        for (const listener of listeners) listener(action);
      });
    },
  };
}

describe("Help under a host bar", () => {
  it("publishes its sections and drops its own header", async () => {
    const host = stubHostBar();
    renderPack("/");

    await screen.findByRole("heading", { name: "User handbook", level: 1 });
    // The host owns the one bar; the pack must not draw its own header band.
    expect(document.querySelector('[data-handbook-region="handbook-header"]')).toBeNull();
    expect(host.setSlots).toHaveBeenCalled();

    const slots = host.setSlots.mock.calls.at(-1)?.[0];
    expect(slots?.title).toBe("User handbook");
    const menu = slots?.navigation.find((control) => control.kind === "menu");
    expect(menu?.kind === "menu" ? menu.items.map((item) => item.id) : []).toContain(
      "help.sections.explorer",
    );
  });

  it("navigates when the host echoes a press", async () => {
    const host = stubHostBar();
    renderPack("/");
    await screen.findByRole("heading", { name: "User handbook", level: 1 });

    await host.send({ id: "help.sections", item: "help.sections.explorer" });

    expect(window.location.hash.startsWith("#/explore")).toBe(true);
  });
});
