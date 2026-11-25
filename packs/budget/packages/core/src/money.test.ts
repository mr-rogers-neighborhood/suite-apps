import { describe, expect, it } from "vitest";

import { formatMoneyPlain, parseMoney } from "./money";

function parse(value: string, currency = "USD", scale = 2): number {
  const result = parseMoney(value, currency, scale);
  if (result.isErr()) throw result.error;
  return result.value;
}

describe("parseMoney", () => {
  it("should read a plain decimal", () => {
    expect(parse("12.34")).toBe(1234);
    expect(parse("-12.34")).toBe(-1234);
    expect(parse("12")).toBe(1200);
  });

  it("should read thousands and decimal separators", () => {
    expect(parse("1,234.56")).toBe(123456);
    expect(parse("1.234,56")).toBe(123456);
    expect(parse("$1,234")).toBe(123400);
    expect(parse("12,50")).toBe(1250);
    expect(parse("1.234")).toBe(123);
  });

  it("should read parentheses as negative", () => {
    expect(parse("(12.00)")).toBe(-1200);
  });

  it("should round to the currency scale", () => {
    expect(parse("0.500")).toBe(50);
    expect(parse("1.005")).toBe(101);
  });

  it("should round half up at the boundary without floating point", () => {
    expect(parse("2.675")).toBe(268);
    expect(parse("-2.675")).toBe(-268);
    expect(parse("0.005")).toBe(1);
    expect(parse("123.455")).toBe(12346);
    expect(parse("1.2345", "KWD", 3)).toBe(1235);
    expect(parse("1.2344", "KWD", 3)).toBe(1234);
    expect(parse("1234.5", "JPY", 0)).toBe(1235);
    expect(parse("1234.4", "JPY", 0)).toBe(1234);
  });

  it("should respect a three-decimal currency", () => {
    expect(parse("1,234", "KWD", 3)).toBe(1234000);
    expect(parse("1.234", "KWD", 3)).toBe(1234);
  });

  it("should reject empty and non-numeric input", () => {
    expect(parseMoney("", "USD").isErr()).toBe(true);
    expect(parseMoney("abc", "USD").isErr()).toBe(true);
  });

  it("should reject separators and signs with no digits instead of reading zero", () => {
    for (const value of [".", ",", ". ", " ,", "-.", "-", "(,)", "($)", "€"]) {
      expect(parseMoney(value, "USD").isErr()).toBe(true);
    }
  });

  it("should reject a misplaced sign and a broken grouping", () => {
    for (const value of ["12-34", "--5", "1.2.3", "1,23,456", "1..2", "1,2345,678"]) {
      expect(parseMoney(value, "USD").isErr()).toBe(true);
    }
  });

  it("should accept grouped digits on both separator styles", () => {
    expect(parse("1,234,567.89")).toBe(123456789);
    expect(parse("1.234.567,89")).toBe(123456789);
    expect(parse("(1.234.567,89)")).toBe(-123456789);
  });

  it("should round-trip through the plain formatter", () => {
    for (const minor of [0, 1, 1234, -1234, 100000]) {
      expect(parse(formatMoneyPlain(minor, 2))).toBe(minor);
    }
    expect(formatMoneyPlain(-5, 2)).toBe("-0.05");
    expect(formatMoneyPlain(-5, 0)).toBe("-5");
  });
});
