import "./prelude";

/**
 * The pack's entry.
 *
 * The static import above runs first and installs `window.suiteDesktop`; only then may the
 * renderer be imported, because `boot()` reads that global at import time and the store reads the
 * session once. This is the same order the Electron build uses; the host is the only difference.
 */
await import("../../src/main");
