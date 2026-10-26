// Parses products pasted from Excel / Google Sheets (tab-separated) or a CSV
// file. Columns, in order: SKU, name, price, quantity, cost (optional).
// A first row that is not data (e.g. "SKU, Name, Price, Qty") is skipped.
import { parseMoneyToMinor, parseNonNegativeInt } from "./numbers";

export const MAX_IMPORT_ROWS = 1000;

export type ImportField = "sku" | "name" | "price" | "quantity" | "cost";

export type ImportRow = {
  /** 1-based line in the pasted text, for messages. */
  line: number;
  sku: string;
  name: string;
  unit_price_minor: number | null;
  quantity: number | null;
  cost_minor: number | null;
  errors: ImportField[];
  duplicate: boolean;
};

/** Splits one line, honouring "quoted, values" and "" escapes. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (c === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function delimiterOf(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";") && !line.includes(",")) return ";";
  return ",";
}

/** Money cells may contain a currency sign or thousands separators: "₪1,250.50". */
function money(cell: string): number | null {
  return parseMoneyToMinor(cell.replace(/[₪$€\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, ""));
}

export function parseImportText(text: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  lines.forEach((raw, index) => {
    if (raw.trim() === "") return;
    const [sku = "", name = "", priceCell = "", qtyCell = "", costCell = ""] = splitLine(raw, delimiterOf(raw));
    const unit_price_minor = money(priceCell || "0");
    const quantity = parseNonNegativeInt(qtyCell || "0");
    const cost_minor = costCell ? money(costCell) : null;

    // Header row: neither price nor quantity is a number.
    if (rows.length === 0 && unit_price_minor === null && quantity === null) return;

    const errors: ImportField[] = [];
    if (!sku || sku.length > 64) errors.push("sku");
    if (!name || name.length > 200) errors.push("name");
    if (unit_price_minor === null) errors.push("price");
    if (quantity === null) errors.push("quantity");
    if (costCell && cost_minor === null) errors.push("cost");
    rows.push({ line: index + 1, sku, name, unit_price_minor, quantity, cost_minor, errors, duplicate: false });
  });

  // The same SKU twice in one paste (case-insensitive, like the database).
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = row.sku.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.sku && (seen.get(row.sku.toLowerCase()) ?? 0) > 1) row.duplicate = true;
  }
  return rows;
}

export function rowIsValid(row: ImportRow): boolean {
  return row.errors.length === 0 && !row.duplicate;
}
