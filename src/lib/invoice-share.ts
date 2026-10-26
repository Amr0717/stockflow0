// Text summary of an issued invoice for WhatsApp (*bold* is WhatsApp markup).
import { fill, type Dictionary } from "./i18n/dictionaries";

const MAX_LINES = 40;

export function buildInvoiceShareText({
  t,
  businessName,
  phone,
  invoiceNumber,
  date,
  customer,
  lines,
  total,
  footer,
}: {
  t: Dictionary;
  businessName: string;
  phone: string;
  invoiceNumber: string;
  date: string;
  customer: string | null;
  lines: { name: string; sku: string; quantity: string; total: string }[];
  total: string;
  footer: string;
}): string {
  const out: string[] = [];
  if (businessName) out.push(`*${businessName}*`);
  out.push(fill(t.invoices.whatsappHeader, { number: invoiceNumber }));
  out.push(`${t.common.date}: ${date}`);
  if (customer) out.push(`${t.invoices.customer}: ${customer}`);
  out.push("");
  lines.slice(0, MAX_LINES).forEach((line, i) => out.push(`${i + 1}. ${fill(t.invoices.whatsappLine, line)}`));
  if (lines.length > MAX_LINES) out.push(`… +${lines.length - MAX_LINES}`);
  out.push("");
  out.push(`*${t.invoices.total}: ${total}*`);
  if (footer) out.push(footer);
  if (phone) out.push(phone);
  return out.join("\n");
}
