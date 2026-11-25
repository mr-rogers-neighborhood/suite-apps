import { describe, expect, it } from "vitest";

import { plainTextToContent } from "./notesEditor";

describe("plainTextToContent", () => {
  it("should turn an empty note into one empty paragraph", () => {
    expect(plainTextToContent("")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("should keep each line and every literal character", () => {
    const content = plainTextToContent("one\ntwo <&> `three`");

    expect(content.content?.[0]?.content).toEqual([
      { type: "text", text: "one" },
      { type: "hardBreak" },
      { type: "text", text: "two <&> `three`" },
    ]);
  });
});
