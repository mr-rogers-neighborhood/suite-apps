import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseRelayChildCommand,
  parseRelayChildOptions,
  RELAY_CHILD_PROTOCOL,
  type RelayChildReport,
  runRelayChild,
  startRelayChild,
} from "./child.js";

const directories: string[] = [];

async function storeDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "suite-relay-child-"));
  directories.push(directory);
  return join(directory, "store");
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

class ReportStream {
  readonly items: RelayChildReport[] = [];
  readonly #waiters: Array<{
    type: string;
    resolve: (report: RelayChildReport) => void;
  }> = [];

  constructor(stream: Readable) {
    createInterface({ input: stream, crlfDelay: Infinity }).on("line", (line) => {
      let report: RelayChildReport;
      try {
        report = JSON.parse(line) as RelayChildReport;
      } catch {
        return;
      }
      this.items.push(report);
      for (const waiter of [...this.#waiters]) {
        if (waiter.type !== report.type) continue;
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        waiter.resolve(report);
      }
    });
  }

  next(type: string, timeoutMs = 8_000): Promise<RelayChildReport> {
    const existing = this.items.find((report) => report.type === type);
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise<RelayChildReport>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`no ${type} report; saw ${this.items.map((item) => item.type).join(", ")}`),
        );
      }, timeoutMs);
      this.#waiters.push({
        type,
        resolve: (report) => {
          clearTimeout(timer);
          resolve(report);
        },
      });
    });
  }
}

describe("the relay child arguments", () => {
  it("defaults to loopback and a free port", () => {
    const parsed = parseRelayChildOptions(["--store", "/tmp/relay"]);
    expect(parsed).toEqual({
      ok: true,
      value: { host: "127.0.0.1", port: 0, store: "/tmp/relay" },
    });
    expect(parsed.ok && Object.keys(parsed.value)).toEqual(["host", "port", "store"]);
  });

  it("takes a host, a port and a store", () => {
    const parsed = parseRelayChildOptions([
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
      "--store",
      "/tmp/relay",
    ]);
    expect(parsed.ok && parsed.value).toEqual({
      host: "0.0.0.0",
      port: 9000,
      store: "/tmp/relay",
    });
  });

  it("refuses a documents grant by name", () => {
    for (const flag of ["--documents", "--document", "--file", "--files", "--data"]) {
      const parsed = parseRelayChildOptions(["--store", "/tmp/relay", flag, "/tmp/docs"]);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.error).toContain("without a documents grant");
      expect(!parsed.ok && parsed.error).toContain(flag);
    }
  });

  it("refuses an argument it does not know", () => {
    expect(parseRelayChildOptions(["--store", "/tmp/relay", "--workspace", "x"])).toMatchObject({
      ok: false,
    });
    expect(parseRelayChildOptions(["--store", "/tmp/relay", "--wat"])).toEqual({
      ok: false,
      error: "unknown argument: --wat",
    });
  });

  it("needs a store", () => {
    expect(parseRelayChildOptions([])).toEqual({ ok: false, error: "--store needs a value" });
  });

  it("reads only the stop and status commands", () => {
    expect(parseRelayChildCommand('{"type":"stop"}')).toBe("stop");
    expect(parseRelayChildCommand('{"type":"status"}')).toBe("status");
    expect(parseRelayChildCommand('{"type":"open-document"}')).toBeNull();
    expect(parseRelayChildCommand("stop")).toBeNull();
  });
});

describe("the relay child", () => {
  it("starts with its own store and reports the address, pin and code", async () => {
    const store = await storeDir();
    const child = await startRelayChild({ host: "127.0.0.1", port: 0, store, version: "test" });
    try {
      expect(child.state.running).toBe(true);
      expect(child.state.address).toMatch(/^wss:\/\/127\.0\.0\.1:\d+\/sync$/u);
      expect(child.state.bind).toMatch(/^127\.0\.0\.1:\d+$/u);
      expect(child.state.secure).toBe(true);
      expect(child.state.fingerprint).toMatch(/^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/u);
      expect(child.state.code).toContain("suite://relay?");
      expect(child.state.code).toContain("f=");
      expect(child.state.consoleUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/console\?token=/u);
      expect(child.state.store).toBe(store);
      expect(child.state.version).toBe("test");
    } finally {
      await child.close();
    }
  });

  it("writes readiness, answers status and stops before it exits", async () => {
    const store = await storeDir();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const reports = new ReportStream(stdout);
    const running = runRelayChild(["--store", store, "--port", "0"], {
      version: "test",
      stdin,
      stdout,
      stderr,
      installSignals: false,
    });

    const ready = await reports.next("ready");
    expect(ready.protocol).toBe(RELAY_CHILD_PROTOCOL);
    expect(ready.state.running).toBe(true);
    expect(ready.state.store).toBe(store);
    // The relay has no documents grant: its handshake names no document path.
    expect(JSON.stringify(ready)).not.toContain("documents");

    stdin.write('{"type":"status"}\n');
    const status = await reports.next("status");
    expect(status.state.address).toBe(ready.state.address);

    stdin.write('{"type":"stop"}\n');
    const stopped = await reports.next("stopped");
    expect(stopped.state.running).toBe(false);
    expect(stopped.state.address).toBeNull();
    expect(stopped.state.store).toBe(store);
    expect(await running).toBe(0);
  });

  it("refuses a document argument without starting the relay", async () => {
    const store = await storeDir();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const code = await runRelayChild(["--store", store, "--documents", "/tmp/docs"], {
      version: "test",
      stdin: new PassThrough(),
      stdout,
      stderr,
      installSignals: false,
    });
    expect(code).toBe(2);
    const text = await new Promise<string>((resolve) => {
      let seen = "";
      stderr.on("data", (chunk) => {
        seen += String(chunk);
        if (seen.includes("\n")) resolve(seen);
      });
    });
    expect(text).toContain("without a documents grant");
  });
});
