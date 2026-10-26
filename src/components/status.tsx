import { Badge } from "@/components/ui/badge";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { InvoiceStatus, MovementType, StockMovement } from "@/lib/types";

export function InvoiceStatusBadge({ status, t }: { status: InvoiceStatus; t: Dictionary }) {
  const tone = status === "issued" ? "success" : status === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{t.invoices[status]}</Badge>;
}

export function MovementTypeBadge({ type, t }: { type: MovementType; t: Dictionary }) {
  const tone =
    type === "sale" ? "accent" : type === "cancellation" ? "warning" : type === "adjustment" ? "neutral" : "success";
  return <Badge tone={tone}>{t.movements[type]}</Badge>;
}

export function StockLevel({
  quantity,
  threshold,
  t,
  locale,
}: {
  quantity: number;
  threshold: number;
  t: Dictionary;
  locale: string;
}) {
  const value = new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "en-US").format(quantity);
  if (quantity === 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="ltr-value font-semibold text-danger">{value}</span>
        <Badge tone="danger">{t.products.outOfStock}</Badge>
      </span>
    );
  }
  if (quantity <= threshold) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="ltr-value font-semibold text-warning">{value}</span>
        <Badge tone="warning">{t.products.lowStock}</Badge>
      </span>
    );
  }
  return <span className="ltr-value font-semibold">{value}</span>;
}

export function Delta({ value }: { value: number }) {
  return (
    <span className={`ltr-value font-semibold ${value > 0 ? "text-success" : "text-danger"}`}>
      {value > 0 ? `+${value}` : `−${Math.abs(value)}`}
    </span>
  );
}

/** System reasons are stored in English; show them translated. */
export function movementReason(m: Pick<StockMovement, "movement_type" | "reason">, t: Dictionary) {
  if (m.movement_type === "initial" && m.reason === "Initial stock") return t.movements.initial;
  if (m.movement_type === "sale" && m.reason === "Invoice issued") return t.movements.sale;
  if (m.movement_type === "cancellation" && m.reason === "Invoice cancelled") return t.movements.cancellation;
  return m.reason;
}

/** "45 → 50" that reads correctly in both directions (arrow follows the text direction). */
export function BeforeAfter({ before, after, locale }: { before: number; after: number; locale: string }) {
  return (
    <span className="whitespace-nowrap text-ink-soft">
      <span className="ltr-value">{before}</span> {locale === "ar" ? "←" : "→"} <span className="ltr-value">{after}</span>
    </span>
  );
}
