import { describe, expect, it } from "vitest";
import { parseImportText, rowIsValid } from "@/lib/import";

describe("parseImportText", () => {
  it("reads rows pasted from Excel (tabs) and skips the header", () => {
    const rows = parseImportText("SKU\tName\tPrice\tQty\n000123\tBlue shirt\t19.95\t10\nA-2\tقميص\t5\t0\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, sku: "000123", name: "Blue shirt", unit_price_minor: 1995, quantity: 10, cost_minor: null, errors: [] });
    expect(rows[1]).toMatchObject({ sku: "A-2", name: "قميص", unit_price_minor: 500, quantity: 0 });
  });

  it("reads CSV with quotes, an optional cost column and Windows line endings", () => {
    const rows = parseImportText('B-1,"Shirt, large",₪1,250.50,3,800\r\nB-2,Cap,7,,\r\n');
    // Unquoted "1,250.50" in a CSV splits into two cells; the row is flagged, never guessed.
    expect(rows[0]).toMatchObject({ sku: "B-1", name: "Shirt, large", errors: ["quantity"] });
    const quoted = parseImportText('B-1,"Shirt, large","1,250.50",3,800');
    expect(quoted[0]).toMatchObject({ unit_price_minor: 125050, quantity: 3, cost_minor: 80000, errors: [] });
    expect(rows[1]).toMatchObject({ sku: "B-2", unit_price_minor: 700, quantity: 0, cost_minor: null, errors: [] });
  });

  it("accepts Arabic-Indic digits and empty price/quantity as 0", () => {
    const rows = parseImportText("C-1\tمنتج\t١٩٫٩٥\t١٢\nC-2\tآخر\t\t");
    expect(rows[0]).toMatchObject({ unit_price_minor: 1995, quantity: 12 });
    expect(rows[1]).toMatchObject({ unit_price_minor: 0, quantity: 0, errors: [] });
  });

  it("flags bad cells and duplicate SKUs (case-insensitive)", () => {
    const rows = parseImportText("X1\tA\t1\t1\n\tNo SKU\t1\t1\nx1\tB\tabc\t1.5\nY\tC\t1\t-2");
    expect(rows.map((r) => [r.errors, r.duplicate])).toEqual([
      [[], true],
      [["sku"], false],
      [["price", "quantity"], true],
      [["quantity"], false],
    ]);
    expect(rows.filter(rowIsValid)).toHaveLength(0);
  });

  it("ignores blank lines", () => {
    expect(parseImportText("\n\n  \nD\tE\t1\t1\n\n")).toHaveLength(1);
  });
});
