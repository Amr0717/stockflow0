import Link from "next/link";
import type { Metadata } from "next";
import { FilePlus2, FileText } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { InvoiceStatusBadge } from "@/components/status";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { addDays, formatDateTime, zonedDayStartUtc } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/numbers";
import type { Invoice } from "@/lib/types";

export const metadata: Metadata = { title: "Invoices" };

const PAGE_SIZE = 25;
const STATUSES = ["draft", "issued", "cancelled"] as const;

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = (STATUSES as readonly string[]).includes(one(sp.status)) ? one(sp.status) : "";
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);

  const { supabase } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);
  const tz = settings.timezone;

  let query = supabase
    .from("invoices")
    .select("id, invoice_number, status, customer_name, total_minor, currency_code, issued_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);

  // Date filter: issue date for issued/cancelled invoices, creation date for drafts.
  // Days are interpreted in the owner's time zone (default Asia/Hebron).
  const fromUtc = from ? zonedDayStartUtc(from, tz) : null;
  const toStart = to ? zonedDayStartUtc(to, tz) : null;
  const toUtc = toStart ? addDays(toStart, 1) : null;
  if (fromUtc || toUtc) {
    const range = (col: string) =>
      [fromUtc && `${col}.gte.${fromUtc.toISOString()}`, toUtc && `${col}.lt.${toUtc.toISOString()}`].filter(Boolean).join(",");
    query = query.or(`and(${range("issued_at")}),and(issued_at.is.null,${range("created_at")})`);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const invoices = (data ?? []) as Invoice[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const filtered = Boolean(status || from || to);

  return (
    <>
      <PageHeader
        title={t.invoices.title}
        actions={
          <ButtonLink href="/invoices/new">
            <FilePlus2 aria-hidden className="size-4" />
            {t.invoices.new}
          </ButtonLink>
        }
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="space-y-1">
            <label htmlFor="status" className="block text-xs font-medium text-ink-muted">{t.invoices.filterStatus}</label>
            <Select id="status" name="status" defaultValue={status} className="w-40">
              <option value="">{t.common.all}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t.invoices[s]}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="from" className="block text-xs font-medium text-ink-muted">{t.common.from}</label>
            <Input id="from" name="from" type="date" defaultValue={from} className="w-44" />
          </div>
          <div className="space-y-1">
            <label htmlFor="to" className="block text-xs font-medium text-ink-muted">{t.common.to}</label>
            <Input id="to" name="to" type="date" defaultValue={to} className="w-44" />
          </div>
          <Button type="submit" variant="secondary">{t.common.filter}</Button>
          {filtered && (
            <Link href="/invoices" className="h-10 px-2 text-sm leading-10 text-ink-muted hover:text-ink">{t.common.clear}</Link>
          )}
        </form>

        {invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filtered ? t.invoices.noResults : t.invoices.empty}
            action={!filtered && <ButtonLink href="/invoices/new">{t.invoices.new}</ButtonLink>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-subtle/70 text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 text-start font-medium">{t.invoices.number}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.invoices.customer}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.common.date}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.invoices.status}</th>
                  <th scope="col" className="px-5 py-2.5 text-end font-medium">{t.invoices.total}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-subtle/50">
                    <td className="px-5 py-3">
                      <Link href={`/invoices/${inv.id}`} className="font-semibold text-accent-ink hover:underline">
                        {inv.invoice_number ? <span className="ltr-value">{inv.invoice_number}</span> : t.invoices.draft}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{inv.customer_name ?? <span className="text-ink-muted">—</span>}</td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-ink-muted">
                      {formatDateTime(inv.issued_at ?? inv.created_at, locale, tz)}
                    </td>
                    <td className="px-3 py-3"><InvoiceStatusBadge status={inv.status} t={t} /></td>
                    <td className={`ltr-value px-5 py-3 text-end font-semibold ${inv.status === "cancelled" ? "text-ink-muted line-through" : ""}`}>
                      {formatMoney(inv.total_minor, inv.currency_code, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          basePath="/invoices"
          params={{ status: status || undefined, from: from || undefined, to: to || undefined }}
          t={t}
        />
      </Card>
    </>
  );
}
