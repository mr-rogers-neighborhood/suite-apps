import { parseRelayLink } from "@suite/sync";
import { describe, expect, it } from "vitest";
import type { RelayCode } from "./shared.js";
import { closeAction, relayCode, relayLink, type ShellState, trayMenu } from "./shell.js";

const running: ShellState = {
  running: true,
  address: "wss://192.168.1.20:8787/sync",
  fingerprint:
    "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
  consoleUrl: "http://127.0.0.1:41234/console?token=abc",
  problem: null,
};

const stopped: ShellState = {
  running: false,
  address: null,
  fingerprint: null,
  consoleUrl: null,
  problem: null,
};

describe("the relay link", () => {
  it("is the address and the pin, and parses back to the same facts", () => {
    const link = relayLink(running);
    expect(link).not.toBeNull();
    const parsed = parseRelayLink(link ?? "");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.url).toBe(running.address);
    expect(parsed.value.fingerprint).toBe(running.fingerprint);
    expect(parsed.value.workspaceId).toBeNull();
    expect(parsed.value.inviteId).toBeNull();
  });

  it("has no link to give away while the relay is stopped", () => {
    expect(relayLink(stopped)).toBeNull();
  });
});

describe("the relay code", () => {
  const code = relayCode(running) as RelayCode | null;

  it("carries exactly the link the copy button copies", () => {
    expect(code).not.toBeNull();
    expect(code?.payload).toBe(relayLink(running));
  });

  it("is a square matrix of `1` and `0` rows", () => {
    expect(code).not.toBeNull();
    if (code === null) return;
    expect(code.rows).toHaveLength(code.size);
    for (const row of code.rows) {
      expect(row).toHaveLength(code.size);
      expect(row).toMatch(/^[01]+$/u);
    }
  });

  it("draws nothing for a relay with no address", () => {
    expect(relayCode(stopped)).toBeNull();
  });
});

describe("the tray menu", () => {
  function labels(state: ShellState): string[] {
    return trayMenu(state).flatMap((item) => (item.kind === "item" ? [item.label] : []));
  }

  function item(state: ShellState, id: string) {
    const found = trayMenu(state).find((entry) => entry.kind === "item" && entry.id === id);
    return found?.kind === "item" ? found : null;
  }

  it("says the relay is running and where it is", () => {
    expect(labels(running)).toContain("Relay running");
    expect(labels(running)).toContain(running.address);
  });

  it("says the relay is stopped, and why when it could not start", () => {
    expect(labels(stopped)).toContain("Relay stopped");
    expect(labels({ ...stopped, problem: "EADDRINUSE" })).toContain("Relay stopped — EADDRINUSE");
  });

  it("offers a link and a console only while there is one", () => {
    expect(item(running, "copy-link")?.enabled).toBe(true);
    expect(item(running, "console")?.enabled).toBe(true);
    expect(item(stopped, "copy-link")?.enabled).toBe(false);
    expect(item(stopped, "console")?.enabled).toBe(false);
  });

  it("always offers the window and a way out", () => {
    for (const state of [running, stopped]) {
      expect(item(state, "window")?.enabled).toBe(true);
      expect(item(state, "quit")?.label).toBe("Quit");
    }
  });

  it("reports status and address as lines, not commands", () => {
    const reports = trayMenu(running).filter((entry) => entry.kind === "item" && entry.id === null);
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report.kind === "item" && report.enabled).toBe(false);
    }
  });
});

describe("closing the window", () => {
  it("hides to the tray, because the relay keeps serving", () => {
    expect(closeAction({ quitting: false, hasTray: true })).toBe("hide");
  });

  it("closes when the app is quitting", () => {
    expect(closeAction({ quitting: true, hasTray: true })).toBe("close");
  });

  it("closes when there is no tray to come back from", () => {
    expect(closeAction({ quitting: false, hasTray: false })).toBe("close");
  });
});
