import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The phone and tablet layout is CSS, so its proof is the rules themselves.
 *
 * `mobile.css` is the one mobile sheet. The assertions below name the decisions that make the
 * pack usable at phone width: the dynamic viewport height, the dock as a bottom bar, the
 * drawer and inspector as sheets, a dialog that scrolls, the 44px floor for a coarse pointer,
 * and the two hover affordances that are always visible on a touch screen. A component test
 * in jsdom has no layout engine, so a rendered width would prove nothing here; `#358` owns the
 * real-device pass.
 */
function read(name: string): string {
  const candidates = [`packs/canvas/src/styles/${name}`, `src/styles/${name}`];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {}
  }
  throw new Error(`could not read ${name} from ${process.cwd()}`);
}

const css = read("mobile.css");

function block(header: string): string {
  const start = css.indexOf(header);
  expect(start, `missing ${header}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, index + 1);
    }
  }
  throw new Error(`unclosed ${header}`);
}

describe("Canvas at phone width", () => {
  it("uses the dynamic viewport and keeps the page to the screen", () => {
    const phone = block("@media (max-width: 640px)");
    expect(phone).toContain("height: 100dvh");
    expect(phone).toContain("width: 100%");
    expect(phone).toContain(".app-canvas");
  });

  it("turns the dock, drawer and inspector into thumb-reachable surfaces", () => {
    const phone = block("@media (max-width: 640px)");
    expect(phone).toMatch(/\.dock\s*\{[^}]*left: 8px;[^}]*right: 8px;/su);
    expect(phone).toMatch(/\.library-drawer\s*\{[^}]*max-height: min\(70dvh, 560px\)/su);
    expect(phone).toMatch(/\.card-inspector\s*\{[^}]*max-height: 62dvh/su);
    expect(phone).toMatch(/\.card-focus__sheet\s*\{[^}]*width: 100%;[^}]*height: 100%/su);
    expect(phone).toMatch(/\[data-testid="sync-dialog"\][^{]*\{[^}]*overflow-y: auto/su);
  });

  it("meets the 44px floor for a coarse pointer", () => {
    const coarse = block("@media (pointer: coarse)");
    expect(coarse).toContain("min-height: 44px");
    expect(coarse).toContain("min-width: 44px");
    for (const selector of [
      ".app-bar button",
      ".dock-button",
      ".library-tab",
      ".library-row-menu",
      ".card-focus__button",
      '[role="dialog"] button',
      '[role="menu"] [role="menuitem"]',
      '[data-testid="format-toolbar"] button',
      ".react-flow__controls-button",
    ]) {
      expect(coarse, selector).toContain(selector);
    }
  });

  it("does not rely on hover on a touch screen", () => {
    const coarse = block("@media (pointer: coarse)");
    expect(coarse).toMatch(/\.library-row-menu\s*\{[^}]*opacity: 1/su);
    expect(coarse).toMatch(/\.library-row\s*\{[^}]*touch-action: pan-y/su);
  });

  it("keeps form text at 16px so a phone does not zoom under the keyboard", () => {
    const phone = block("@media (max-width: 640px)");
    expect(phone).toMatch(/\[role="dialog"\] input[\s\S]*font-size: 16px/u);
  });
});
