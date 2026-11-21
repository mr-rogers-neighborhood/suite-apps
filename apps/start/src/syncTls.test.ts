import { createHash, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { formatFingerprint } from "@suite/sync";
import { describe, expect, it } from "vitest";
import { ensureRelayCertificate } from "./syncTls.js";

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "suite-start-tls-"));
}

describe("the managed relay's certificate", () => {
  it("writes a readable pair mode 0600 and reports its SHA-256 fingerprint", async () => {
    const directory = await folder();
    const pair = ensureRelayCertificate(directory);

    expect(pair.fingerprint).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u);
    expect((await stat(pair.certPath)).mode & 0o777).toBe(0o600);
    expect((await stat(pair.keyPath)).mode & 0o777).toBe(0o600);

    const certificate = await readFile(pair.certPath, "utf8");
    expect(certificate).toContain("-----BEGIN CERTIFICATE-----");
    expect(await readFile(pair.keyPath, "utf8")).toContain("-----BEGIN PRIVATE KEY-----");
    expect(new X509Certificate(certificate).subject).toContain("CN=Suite Start relay");
  });

  it("reuses the same pair, so every device keeps the fingerprint it pinned", async () => {
    const directory = await folder();
    const first = ensureRelayCertificate(directory);
    const cert = await readFile(first.certPath, "utf8");
    const key = await readFile(first.keyPath, "utf8");

    const second = ensureRelayCertificate(directory);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(await readFile(second.certPath, "utf8")).toBe(cert);
    expect(await readFile(second.keyPath, "utf8")).toBe(key);
  });

  it("serves TLS with the pair it made", async () => {
    const pair = ensureRelayCertificate(await folder());
    const server = createServer(
      { cert: await readFile(pair.certPath), key: await readFile(pair.keyPath) },
      (_request, response) => response.end("ok"),
    );

    try {
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (typeof address === "object" && address !== null) resolve(address.port);
          else reject(new Error("no port"));
        });
      });

      const answer = await new Promise<string>((resolve, reject) => {
        const call = request(
          { host: "127.0.0.1", port, path: "/", rejectUnauthorized: false },
          (response) => {
            const socket = response.socket as TLSSocket | null;
            const peer = socket?.getPeerCertificate();
            if (peer === undefined || peer.raw === undefined) {
              reject(new Error("the client saw no peer certificate"));
              return;
            }
            expect(formatFingerprint(createHash("sha256").update(peer.raw).digest("hex"))).toBe(
              pair.fingerprint,
            );
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
            });
            response.on("end", () => resolve(body));
          },
        );
        call.once("error", reject);
        call.end();
      });

      expect(answer).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses half a pair instead of rotating the fingerprint", async () => {
    const directory = await folder();
    const first = ensureRelayCertificate(directory);
    await writeFile(first.certPath, `${await readFile(first.certPath, "utf8")}\n`);

    // A pair that is still whole is still the same pair.
    expect(ensureRelayCertificate(directory).fingerprint).toBe(first.fingerprint);

    const half = await folder();
    await writeFile(join(half, "relay-cert.pem"), await readFile(first.certPath, "utf8"));
    expect(() => ensureRelayCertificate(half)).toThrow(/incomplete/u);
  });
});
