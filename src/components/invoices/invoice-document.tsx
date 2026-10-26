import { InvoiceStatusBadge } from "@/components/status";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatMoney, formatNumber } from "@/lib/numbers";
import type { Invoice, InvoiceItem, OwnerSettings } from "@/lib/types";

/** The printable A4 invoice (also shown on screen). Uses only frozen snapshot data. */
export function InvoiceDocument({
  invoice,
  items,
  settings,
  t,
  locale,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  settings: OwnerSettings;
  t: Dictionary;
  locale: "ar" | "en";
}) {
  const money = (minor: number) => formatMoney(minor, invoice.currency_code, locale);
  const tz = settings.timezone;

  return (
    <article className="print-area relative mx-auto max-w-[210mm] overflow-hidden rounded-xl border border-line bg-white p-6 shadow-[var(--shadow-card)] sm:p-10">
      {invoice.status === "cancelled" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[5rem] font-bold tracking-widest text-danger/10 -rotate-12 select-none"
        >
          {t.invoices.cancelled}
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-6">
        <div className="min-w-0 space-y-1">
          <p className="text-xl font-bold">{settings.business_name || t.app.name}</p>
          {settings.business_address && <p className="text-sm whitespace-pre-line text-ink-soft">{settings.business_address}</p>}
          {settings.business_phone && <p className="ltr-value text-sm text-ink-soft">{settings.business_phone}</p>}
          {settings.business_tax_id && (
            <p className="text-sm text-ink-soft">
              {t.settings.taxId}: <span className="ltr-value">{settings.business_tax_id}</span>
            </p>
          )}
        </div>
        <div className="space-y-1 text-end">
          <p className="text-2xl font-bold tracking-tight text-accent-ink">{t.invoices.invoice}</p>
          <p className="text-sm">
            <span className="text-ink-muted">{t.invoices.number}: </span>
            <span className="ltr-value font-semibold">{invoice.invoice_number ?? t.invoices.draft}</span>
          </p>
          <p className="text-sm">
            <span className="text-ink-muted">{t.common.date}: </span>
            {formatDate(invoice.issued_at ?? invoice.created_at, locale, tz)}
          </p>
          <div className="pt-1">
            <InvoiceStatusBadge status={invoice.status} t={t} />
          </div>
        </div>
      </header>

      {invoice.customer_name && (
        <section className="mt-6">
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{t.invoices.billTo}</p>
          <p className="mt-1 font-semibold">{invoice.customer_name}</p>
        </section>
      )}

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-line-strong text-xs text-ink-muted">
            <th scope="col" className="w-8 py-2 pe-3 text-start font-medium">#</th>
            <th scope="col" className="py-2 text-start font-medium">{t.invoices.item}</th>
            <th scope="col" className="py-2 ps-3 text-end font-medium">{t.invoices.quantity}</th>
            <th scope="col" className="py-2 ps-4 text-end font-medium">{t.invoices.unitPrice}</th>
            <th scope="col" className="py-2 ps-4 text-end font-medium">{t.invoices.lineTotal}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-2.5 pe-3 text-ink-muted"><span className="ltr-value">{item.line_no}</span></td>
              <td className="py-2.5 pe-3">
                <p className="font-medium">{item.product_name}</p>
                <p className="ltr-value text-xs text-ink-muted">{item.sku}</p>
              </td>
              <td className="py-2.5 ps-3 text-end"><span className="ltr-value">{formatNumber(item.quantity, locale)}</span></td>
              <td className="py-2.5 ps-4 text-end whitespace-nowrap"><span className="ltr-value">{money(item.unit_price_minor)}</span></td>
              <td className="py-2.5 ps-4 text-end font-medium whitespace-nowrap"><span className="ltr-value">{money(item.line_total_minor)}</span></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink">
            <td colSpan={4} className="pt-3 pe-4 text-end font-semibold">{t.invoices.total}</td>
            <td className="pt-3 text-end text-lg font-bold whitespace-nowrap"><span className="ltr-value">{money(invoice.total_minor)}</span></td>
          </tr>
        </tfoot>
      </table>

      {invoice.notes && (
        <section className="mt-8">
          <p className="text-xs font-medium text-ink-muted">{t.invoices.notes}</p>
          <p className="mt-1 text-sm whitespace-pre-line">{invoice.notes}</p>
        </section>
      )}

      {invoice.status === "cancelled" && (
        <section className="mt-6 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <p className="font-semibold">
            {t.invoices.cancelledAt}: {formatDateTime(invoice.cancelled_at, locale, tz)}
          </p>
          {invoice.cancel_reason && (
            <p>
              {t.invoices.cancelReason}: {invoice.cancel_reason}
            </p>
          )}
        </section>
      )}

      <footer className="mt-10 border-t border-line pt-4 text-center text-xs text-ink-muted">
        {settings.invoice_footer || t.invoices.thankYou}
      </footer>
    </article>
  );
}
