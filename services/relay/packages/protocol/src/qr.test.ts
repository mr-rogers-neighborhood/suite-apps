import { describe, expect, it } from "vitest";
import { qrMatrix, qrSvg } from "./qr.js";

const payload =
  "suite://relay?u=wss%3A%2F%2F192.168.1.20%3A8787%2Fsync&f=" +
  "AA%3ABB%3ACC%3ADD%3AEE%3AFF%3A00%3A11%3A22%3A33%3A44%3A55%3A66%3A77%3A88%3A99";

describe("a relay QR code", () => {
  it("returns a square matrix of dark and light modules", () => {
    const matrix = qrMatrix(payload);
    expect(matrix.size).toBeGreaterThan(20);
    expect(matrix.rows).toHaveLength(matrix.size);
    for (const row of matrix.rows) {
      expect(row).toHaveLength(matrix.size);
      expect(row).toMatch(/^[01]+$/u);
    }
    expect(matrix.rows.join("")).toContain("1");
    expect(matrix.rows.join("")).toContain("0");
  });

  it("is deterministic and grows with the payload", () => {
    expect(qrMatrix(payload).rows).toEqual(qrMatrix(payload).rows);
    expect(qrMatrix("suite://relay?u=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync").size).toBeLessThan(
      qrMatrix(`${payload}&w=${"a".repeat(64)}&i=${"b".repeat(64)}`).size,
    );
  });

  it("renders one self-contained SVG with a quiet zone and an accessible label", () => {
    const svg = qrSvg(payload, { scale: 4, border: 4, label: "Relay <code>" });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Relay &lt;code&gt;"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain("<path d=");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("javascript:");
  });
});
