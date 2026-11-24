import "./prelude";

/**
 * The pack's entry.
 *
 * The static import above runs first and installs `window.suitePlanner`; only then may the
 * renderer be imported, because `bootDocument()` reads that global at import time.
 */
await import("../../src/renderer/src/main");
