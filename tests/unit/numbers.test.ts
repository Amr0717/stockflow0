import { describe, expect, it } from "vitest";
import {
  formatMoney,
  lineTotalMinor,
  minorToInput,
  parseMoneyToMinor,
  parseNonNegativeInt,
  parsePositiveInt,
  sumMinor,
} from "@/lib/numbers";

describe("parseMoneyToMinor", () => {
  it.each([
    ["19.95", 1995],
    ["19.9", 1990],
    ["19.", 1900],
    ["19", 1900],
    ["0.10", 10],
    ["0.01", 1],
    ["0", 0],
    [" 22.00 ", 2200],
    ["١٩٫٩٥", 1995], // Arabic-Indic digits and decimal mark
  ])("%s -> %d", (input, expected) => {
    expect(parseMoneyToMinor(input)).toBe(expected);
  });

  it.each(["", "-1", "1.234", "abc", "1,000", "1e3", ".5", "1.2.3"])("rejects %j", (input) => {
    expect(parseMoneyToMinor(input)).toBeNull();
  });

  it("avoids floating point errors (0.1 + 0.2)", () => {
    expect(sumMinor([parseMoneyToMinor("0.1")!, parseMoneyToMinor("0.2")!])).toBe(30);
  });
});

describe("integers", () => {
  it.each([
    ["1", 1],
    ["12", 12],
    ["٣", 3],
  ])("parsePositiveInt(%s)", (input, expected) => {
    expect(parsePositiveInt(input)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "", "abc", "1e2"])("parsePositiveInt rejects %j", (input) => {
    expect(parsePositiveInt(input)).toBeNull();
  });

  it("parseNonNegativeInt accepts 0", () => {
    expect(parseNonNegativeInt("0")).toBe(0);
    expect(parseNonNegativeInt("-3")).toBeNull();
    expect(parseNonNegativeInt("2.5")).toBeNull();
  });
});

describe("totals and formatting", () => {
  it("computes exact multi-line totals", () => {
    // 3 x 19.95 + 7 x 0.10 + 3 x 0.33 = 61.54
    const total = sumMinor([lineTotalMinor(3, 1995), lineTotalMinor(7, 10), lineTotalMinor(3, 33)]);
    expect(total).toBe(6154);
    expect(minorToInput(total)).toBe("61.54");
  });

  it("formats money with the currency symbol in both languages", () => {
    expect(formatMoney(6154, "ILS", "en")).toBe("₪61.54");
    const ar = formatMoney(6154, "ILS", "ar");
    expect(ar).toContain("61.54");
    expect(ar).toContain("₪");
  });

  it("formats large values exactly", () => {
    expect(formatMoney(123456789012, "USD", "en")).toBe("$1,234,567,890.12");
  });
});
