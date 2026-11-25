import "@testing-library/jest-dom/vitest";

// ProseMirror asks the layout engine where the caret is when it scrolls a selection into view.
// jsdom has no layout, so the editor's DOM reads have to resolve to empty geometry rather than
// throwing. The rich note editor is the first surface here that exercises those paths.
const emptyRect = new DOMRect(0, 0, 0, 0);
const emptyRectList = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
} as unknown as DOMRectList;

Range.prototype.getClientRects = () => emptyRectList;
Range.prototype.getBoundingClientRect = () => emptyRect;
Element.prototype.getClientRects = () => emptyRectList;
document.elementFromPoint = () => null;

// jsdom has no layout engine, so `offsetParent` is null for every node. The shared Modal uses it
// to skip controls hidden with `display:none` when it wraps Tab inside a dialog; without this the
// trap sees no controls at all and a focus test would be testing jsdom, not the dialog. These
// tests want the browser's answer.
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get() {
    return this.parentElement;
  },
});
