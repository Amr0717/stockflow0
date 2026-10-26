import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { InvoiceDocument } from "@/components/invoices/invoice-document";
import { InvoiceEditor, type EditorLine } from "@/components/invoices/invoice-editor";
import { IssuedInvoiceActions } from "@/components/invoices/issued-actions";
import { BeforeAfter, Delta, InvoiceStatusBadge, MovementTypeBadge } from "@/components/status";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/dates";
import { fill } from "@/lib/i18n/dictionaries";
import { getI18n } from "@/lib/i18n/server";
import { buildInvoiceShareText } from "@/lib/invoice-share";
import { formatMoney, formatNumber, minorToInput } from "@/lib/numbers";
import type { Invoice, InvoiceItem, StockMovement } from "@/lib/types";

export const metadata: Metadata = { title: "Invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();

  const { supabase } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);

  const [invRes, itemsRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("invoice_items")
      .select("*, products(quantity_on_hand)")
      .eq("invoice_id", id)
      .order("line_no"),
  ]);
  if (invRes.error) throw new Error(invRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  const invoice = invRes.data as Invoice | null;
  if (!invoice) notFound();
  const items = (itemsRes.data ?? []) as (InvoiceItem & { products: { quantity_on_hand: number } | null })[];

  if (invoice.status === "draft") {
    const lines: EditorLine[] = items.map((item) => ({
      key: item.id,
      product_id: item.product_id,
      sku: item.sku,
      name: item.product_name,
      available: item.products?.quantity_on_hand ?? 0,
      quantity: String(item.quantity),
      unit_price: minorToInput(item.unit_price_minor),
    }));
    return (
      <>
        <PageHeader title={t.invoices.draftTitle} description={formatDateTime(invoice.created_at, locale, settings.timezone)} />
        <InvoiceEditor
          t={t}
          locale={locale}
          currency={invoice.currency_code}
          invoiceId={invoice.id}
          initialCustomer={invoice.customer_name ?? ""}
          initialNotes={invoice.notes ?? ""}
          initialLines={lines}
          initialMessage={sp.saved === "1" ? t.invoices.draft_saved : undefined}
        />
      </>
    );
  }

  const { data: movesData } = await supabase
    .from("stock_movements")
    .select("id, movement_type, delta, quantity_before, quantity_after, created_at, product_id, products(sku, name)")
    .eq("invoice_id", id)
    .order("created_at");
  const moves = (movesData ?? []) as unknown as StockMovement[];
  const money = (minor: number) => formatMoney(minor, invoice.currency_code, locale);
  const shareText = buildInvoiceShareText({
    t,
    businessName: settings.business_name || t.app.name,
    phone: settings.business_phone,
    invoiceNumber: invoice.invoice_number ?? "",
    date: formatDate(invoice.issued_at ?? invoice.created_at, locale, settings.timezone),
    customer: invoice.customer_name,
    lines: items.map((item) => ({
      name: item.product_name,
      sku: item.sku,
      quantity: formatNumber(item.quantity, locale),
      total: money(item.line_total_minor),
    })),
    total: money(invoice.total_minor),
    footer: settings.invoice_footer || t.invoices.thankYou,
  });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {t.invoices.invoice} <span className="ltr-value">{invoice.invoice_number}</span>
              <InvoiceStatusBadge status={invoice.status} t={t} />
            </span>
          }
          actions={
            <ButtonLink href="/invoices/new" variant="secondary">
              <FilePlus2 aria-hidden className="size-4" />
              {t.invoices.new}
            </ButtonLink>
          }
        />
        <div className="mb-5 space-y-3">
          {sp.issued === "1" && invoice.status === "issued" && (
            <Alert tone="success">{fill(t.invoices.issued_ok, { number: invoice.invoice_number ?? "" })}</Alert>
          )}
          {invoice.status === "cancelled" && <Alert tone="warning">{t.invoices.cancelledNotice}</Alert>}
          <IssuedInvoiceActions
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoice_number ?? ""}
            canCancel={invoice.status === "issued"}
            shareText={shareText}
            t={t}
          />
        </div>
      </div>

      <InvoiceDocument invoice={invoice} items={items} settings={settings} t={t} locale={locale} />

      <Card className="no-print mt-6">
        <CardHeader title={t.invoices.stockMovements} />
        <ul className="divide-y divide-line">
          {moves.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
              <MovementTypeBadge type={m.movement_type} t={t} />
              <Link href={`/products/${m.product_id}`} className="min-w-0 flex-1 truncate hover:underline">
                <span className="ltr-value font-medium">{m.products?.sku}</span>
                <span className="text-ink-muted"> · {m.products?.name}</span>
              </Link>
              <Delta value={m.delta} />
              <BeforeAfter before={m.quantity_before} after={m.quantity_after} locale={locale} />
              <span className="text-xs text-ink-muted">{formatDateTime(m.created_at, locale, settings.timezone)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
