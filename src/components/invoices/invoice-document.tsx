import Image from "next/image";
import { InvoiceStatusBadge } from "@/components/status";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatMoney, formatNumber } from "@/lib/numbers";
import type { Invoice, InvoiceItem, OwnerSettings } from "@/lib/types";

/** Brand logos shown on both sides of the invoice header (public/brand). */
const LOGOS = [
  { src: "/brand/sawalhi-fashion.jpg", alt: "Sawalhi Fashion" },
  { src: "/brand/kmt-sawalhi.jpg", alt: "KMT Sawalhi" },
] as const;

/**
 * The printable A4 invoice (also shown on screen and captured as an image for
 * WhatsApp). Uses only frozen snapshot data. Colours follow the logos:
 * dark brown and gold on warm white.
 */
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
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article
      id="invoice-document"
      className="print-area relative mx-auto max-w-[185mm] overflow-hidden rounded-xl border border-[#e8dcc6] bg-white text-[#2b1d12] shadow-[var(--shadow-card)]"
    >
      {invoice.status === "cancelled" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-[5rem] font-bold tracking-widest text-danger/10 -rotate-12 select-none"
        >
          {t.invoices.cancelled}
        </div>
      )}

      {/* Gold rule */}
      <div aria-hidden className="h-2 bg-gradient-to-l from-[#8a6424] via-[#d9b25f] to-[#8a6424]" />

      <div className="p-5 text-[13px] sm:p-7">
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:gap-5">
          <Logo {...LOGOS[0]} />
          <div className="min-w-0 space-y-1 text-center">
            <p className="text-lg font-bold text-[#3b2416] sm:text-xl">{settings.business_name || t.app.name}</p>
            {settings.business_address && <p className="text-sm whitespace-pre-line text-[#6b5643]">{settings.business_address}</p>}
            {settings.business_phone && <p className="ltr-value text-sm font-medium text-[#6b5643]">{settings.business_phone}</p>}
            {settings.business_tax_id && (
              <p className="text-xs text-[#6b5643]">
                {t.settings.taxId}: <span className="ltr-value">{settings.business_tax_id}</span>
              </p>
            )}
          </div>
          <Logo {...LOGOS[1]} />
        </header>

        <div className="mt-4 flex items-center gap-3">
          <span aria-hidden className="h-px flex-1 bg-[#d9c39a]" />
          <h2 className="text-xl font-bold tracking-wide text-[#3b2416]">{t.invoices.invoice}</h2>
          <span aria-hidden className="h-px flex-1 bg-[#d9c39a]" />
        </div>

        <section className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg bg-[#faf5ec] px-3.5 py-2">
            <p className="text-xs font-medium text-[#8a6424]">{t.invoices.billTo}</p>
            <p className="mt-1 font-semibold">{invoice.customer_name || "—"}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 rounded-lg bg-[#faf5ec] px-3.5 py-2">
            <dt className="text-[#8a6424]">{t.invoices.number}</dt>
            <dd className="ltr-value text-end font-semibold">{invoice.invoice_number ?? t.invoices.draft}</dd>
            <dt className="text-[#8a6424]">{t.common.date}</dt>
            <dd className="text-end">{formatDate(invoice.issued_at ?? invoice.created_at, locale, tz)}</dd>
            <dt className="text-[#8a6424]">{t.invoices.status}</dt>
            <dd className="text-end">
              <InvoiceStatusBadge status={invoice.status} t={t} />
            </dd>
          </dl>
        </section>

        <div className="mt-4 overflow-hidden rounded-lg border border-[#e8dcc6]">
          <table className="w-full">
            <thead>
              <tr className="bg-[#3b2416] text-xs text-[#f3e3c0]">
                <th scope="col" className="w-10 px-3 py-2 text-start font-medium">#</th>
                <th scope="col" className="py-2 text-start font-medium">{t.invoices.item}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t.invoices.quantity}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t.invoices.unitPrice}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t.invoices.lineTotal}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="align-top even:bg-[#faf5ec]">
                  <td className="px-3 py-2 text-[#8a7560]"><span className="ltr-value">{item.line_no}</span></td>
                  <td className="py-2 pe-3">
                    <p className="font-medium">{item.product_name}</p>
                    <p className="ltr-value text-xs text-[#8a7560]">{item.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-end"><span className="ltr-value">{formatNumber(item.quantity, locale)}</span></td>
                  <td className="px-3 py-2 text-end whitespace-nowrap"><span className="ltr-value">{money(item.unit_price_minor)}</span></td>
                  <td className="px-3 py-2 text-end font-semibold whitespace-nowrap"><span className="ltr-value">{money(item.line_total_minor)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-4 flex justify-end">
          <dl className="w-full max-w-64 space-y-1">
            <div className="flex justify-between px-1">
              <dt className="text-[#6b5643]">{t.invoices.itemsCount}</dt>
              <dd className="ltr-value">{formatNumber(items.length, locale)}</dd>
            </div>
            <div className="flex justify-between px-1">
              <dt className="text-[#6b5643]">{t.invoices.totalQuantity}</dt>
              <dd className="ltr-value">{formatNumber(totalQuantity, locale)}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border-2 border-[#b8862f] bg-[#3b2416] px-3.5 py-2 text-[#f3e3c0]">
              <dt className="font-semibold">{t.invoices.total}</dt>
              <dd className="ltr-value text-lg font-bold text-white">{money(invoice.total_minor)}</dd>
            </div>
          </dl>
        </section>

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

        <footer className="mt-6 space-y-1 border-t border-[#e8dcc6] pt-3 text-center">
          <p className="font-semibold text-[#8a6424]">{settings.invoice_footer || t.invoices.thankYou}</p>
          {settings.business_phone && <p className="ltr-value text-xs text-[#8a7560]">{settings.business_phone}</p>}
        </footer>
      </div>

      <div aria-hidden className="h-2 bg-gradient-to-l from-[#8a6424] via-[#d9b25f] to-[#8a6424]" />
    </article>
  );
}

function Logo({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={112}
      height={112}
      priority
      className="size-14 rounded-full object-cover shadow-sm ring-2 ring-[#d9b25f] sm:size-20"
    />
  );
}
