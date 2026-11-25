import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements neither layout nor scrolling. The explorer asks the navigator to scroll to the
// top when the view changes; that call is a no-op here, not a failure.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
