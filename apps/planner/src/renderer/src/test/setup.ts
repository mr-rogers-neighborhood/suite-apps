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
