import { describe, expect, it } from "vitest";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { buildInvoiceShareText } from "@/lib/invoice-share";

const base = {
  t: dictionaries.ar,
  businessName: "صوالحي فاشن",
  phone: "0595671008",
  invoiceNumber: "INV-000012",
  date: "26/10/2026",
  customer: "أبو أحمد",
  total: "₪120.00",
  footer: "شكرًا لتعاملكم!",
};

describe("buildInvoiceShareText", () => {
  it("lists the shop, number, customer, lines and total", () => {
    const text = buildInvoiceShareText({
      ...base,
      lines: [
        { name: "قميص", sku: "000123", quantity: "2", total: "₪40.00" },
        { name: "بنطال", sku: "B-1", quantity: "1", total: "₪80.00" },
      ],
    });
    expect(text.split("\n")).toEqual([
      "*صوالحي فاشن*",
      "فاتورة رقم INV-000012",
      "التاريخ: 26/10/2026",
      "الزبون: أبو أحمد",
      "",
      "1. قميص (000123) × 2 = ₪40.00",
      "2. بنطال (B-1) × 1 = ₪80.00",
      "",
      "*الإجمالي: ₪120.00*",
      "شكرًا لتعاملكم!",
      "0595671008",
    ]);
  });

  it("skips an empty customer and shortens very long invoices", () => {
    const lines = Array.from({ length: 45 }, (_, i) => ({ name: `P${i}`, sku: `S${i}`, quantity: "1", total: "₪1.00" }));
    const text = buildInvoiceShareText({ ...base, customer: null, lines });
    expect(text).not.toContain("الزبون");
    expect(text).toContain("40. P39");
    expect(text).not.toContain("41. P40");
    expect(text).toContain("… +5");
  });
});
