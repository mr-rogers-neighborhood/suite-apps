import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  formatStatus,
  isLoopbackHost,
  parseServeOptions,
  runCli,
} from "./cli.js";

describe("arguments", () => {
  it("defaults to loopback and refuses to check signatures it cannot check", () => {
    const parsed = parseServeOptions([]);
    expect(parsed.ok && parsed.value).toEqual({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      store: ".suite-sync",
      trustAll: false,
      trustAllRemote: false,
      tlsCert: null,
      tlsKey: null,
      allowPlaintext: false,
    });
  });

  it("takes a host, a port and a store", () => {
    const parsed = parseServeOptions(["--host", "0.0.0.0", "--port", "9000", "--store", "/tmp/x"]);
    expect(parsed.ok && parsed.value.host).toBe("0.0.0.0");
    expect(parsed.ok && parsed.value.port).toBe(9000);
    expect(parsed.ok && parsed.value.store).toBe("/tmp/x");
  });

  it("refuses a port that is not one", () => {
    expect(parseServeOptions(["--port", "eighty"])).toEqual({
      ok: false,
      error: "not a port: eighty",
    });
  });

  it("refuses an argument it does not know, rather than ignoring it", () => {
    expect(parseServeOptions(["--workspace", "x"])).toEqual({
      ok: false,
      error: "unknown argument: --workspace",
    });
  });

  it("refuses the remote acknowledgement on its own", () => {
    expect(parseServeOptions(["--trust-all-remote"])).toEqual({
      ok: false,
      error: "--trust-all-remote only means something with --trust-all",
    });
  });

  it("takes a certificate and key together", () => {
    const parsed = parseServeOptions([
      "--tls-cert",
      "/tmp/cert.pem",
      "--tls-key",
      "/tmp/key.pem",
      "--allow-plaintext",
    ]);
    expect(parsed.ok && parsed.value.tlsCert).toBe("/tmp/cert.pem");
    expect(parsed.ok && parsed.value.tlsKey).toBe("/tmp/key.pem");
    expect(parsed.ok && parsed.value.allowPlaintext).toBe(true);
  });

  it("refuses half a TLS pair rather than serving something that cannot start", () => {
    expect(parseServeOptions(["--tls-cert", "/tmp/cert.pem"])).toEqual({
      ok: false,
      error: "--tls-cert and --tls-key go together",
    });
  });
});

describe("loopback", () => {
  it("recognises the addresses that only this machine can reach", () => {
    for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it("does not mistake a wildcard for loopback", () => {
    // `0.0.0.0` and `::` listen everywhere. Treating them as loopback is exactly how a relay
    // left running on a home network becomes an open mailbox.
    for (const host of ["0.0.0.0", "::", "[::]", "192.168.1.20", "relay.example", "127.0.0.256"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe("the command line", () => {
  it("prints its version", async () => {
    const result = await runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("suite-sync");
  });

  it("refuses to serve without device keys, and says why", async () => {
    const result = await runCli(["serve"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no device keys");
  });

  it("refuses to serve plaintext on an address other machines can reach, even when asked why", async () => {
    const result = await runCli([
      "serve",
      "--host",
      "0.0.0.0",
      "--trust-all",
      "--trust-all-remote",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/needs TLS|--tls-cert/u);
  });

  it("refuses to admit any device on an address other machines can reach", async () => {
    const result = await runCli(["serve", "--host", "0.0.0.0", "--trust-all"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--trust-all-remote");
  });

  it("serves once the remote admission is acknowledged, and says what it now is", async () => {
    const result = await runCli([
      "status",
      "--host",
      "0.0.0.0",
      "--trust-all",
      "--trust-all-remote",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("every device that can route");
  });

  it("reports what a serve would do", async () => {
    const result = await runCli(["status", "--trust-all"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("not checked");
  });

  it("says so when the command is not one it has", async () => {
    const result = await runCli(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown command: frobnicate");
  });
});

describe("the status line", () => {
  it("names every choice that changes behaviour", () => {
    const text = formatStatus({
      host: "127.0.0.1",
      port: 8787,
      store: ".suite-sync",
      trustAll: true,
      trustAllRemote: false,
      tlsCert: null,
      tlsKey: null,
      allowPlaintext: false,
    });
    expect(text).toContain("127.0.0.1:8787");
    expect(text).toContain(".suite-sync");
    expect(text).toContain("not checked");
  });

  it("says when a reachable address is plaintext and whether that was chosen", () => {
    const base = {
      host: "0.0.0.0",
      port: 8787,
      store: ".suite-sync",
      trustAll: true,
      trustAllRemote: true,
    };
    expect(formatStatus({ ...base, tlsCert: null, tlsKey: null, allowPlaintext: false })).toContain(
      "refused:",
    );
    expect(formatStatus({ ...base, tlsCert: null, tlsKey: null, allowPlaintext: true })).toContain(
      "warning:",
    );
    expect(
      formatStatus({
        ...base,
        tlsCert: "/etc/suite/cert.pem",
        tlsKey: "/etc/suite/key.pem",
        allowPlaintext: false,
      }),
    ).toContain("wss (certificate pinned)");
  });
});
