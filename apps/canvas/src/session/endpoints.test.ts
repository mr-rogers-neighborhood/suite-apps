import { afterEach, describe, expect, it, vi } from "vitest";
import { collabHttpBase } from "./endpoints";

const PAGE = {
  origin: "https://suite.example.com",
  protocol: "https:",
  host: "suite.example.com",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("collabHttpBase", () => {
  it("uses the dev server by default", () => {
    expect(collabHttpBase(PAGE)).toBe("http://localhost:1235");
  });

  it("prefers a configured URL and trims trailing slashes", () => {
    vi.stubEnv("VITE_COLLAB_HTTP_URL", "https://api.example.com/");
    expect(collabHttpBase(PAGE)).toBe("https://api.example.com");
  });

  it("falls back to the page origin in a production build", () => {
    vi.stubEnv("DEV", false);
    expect(collabHttpBase(PAGE)).toBe("https://suite.example.com");
  });

  it("ignores a blank configured URL", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_COLLAB_HTTP_URL", "  ");
    expect(collabHttpBase(PAGE)).toBe("https://suite.example.com");
  });
});
