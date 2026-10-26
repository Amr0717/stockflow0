import Link from "next/link";
import type { Metadata } from "next";
import { History } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { BeforeAfter, Delta, MovementTypeBadge, movementReason } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { formatDateTime } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import type { MovementType, StockMovement } from "@/lib/types";

export const metadata: Metadata = { title: "Stock history" };

const PAGE_SIZE = 50;
const TYPES: MovementType[] = ["initial", "restock", "adjustment", "sale", "cancellation"];

export default async function MovementsPage({ searchParams }: PageProps<"/movements">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const type = TYPES.includes(one(sp.type) as MovementType) ? one(sp.type) : "";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);

  const { supabase } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);

  let query = supabase
    .from("stock_movements")
    .select(
      "id, movement_type, delta, quantity_before, quantity_after, reason, created_at, product_id, invoice_id, products(sku, name), invoices(invoice_number)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (type) query = query.eq("movement_type", type);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const moves = (data ?? []) as unknown as StockMovement[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader title={t.movements.title} />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="space-y-1">
            <label htmlFor="type" className="block text-xs font-medium text-ink-muted">{t.movements.type}</label>
            <Select id="type" name="type" defaultValue={type} className="w-48">
              <option value="">{t.common.all}</option>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>{t.movements[ty]}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">{t.common.filter}</Button>
        </form>

        {moves.length === 0 ? (
          <EmptyState icon={History} title={t.movements.empty} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-subtle/70 text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 text-start font-medium">{t.common.date}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.movements.product}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.movements.type}</th>
                  <th scope="col" className="px-3 py-2.5 text-end font-medium">{t.movements.change}</th>
                  <th scope="col" className="px-3 py-2.5 text-end font-medium">{t.movements.beforeAfter}</th>
                  <th scope="col" className="px-5 py-2.5 text-start font-medium">{t.movements.reason}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-2.5 text-xs whitespace-nowrap text-ink-muted">{formatDateTime(m.created_at, locale, settings.timezone)}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/products/${m.product_id}`} className="hover:underline">
                        <span className="ltr-value font-semibold">{m.products?.sku}</span>
                        <span className="block text-xs text-ink-muted">{m.products?.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5"><MovementTypeBadge type={m.movement_type} t={t} /></td>
                    <td className="px-3 py-2.5 text-end"><Delta value={m.delta} /></td>
                    <td className="px-3 py-2.5 text-end"><BeforeAfter before={m.quantity_before} after={m.quantity_after} locale={locale} /></td>
                    <td className="px-5 py-2.5">
                      {m.invoice_id ? (
                        <Link href={`/invoices/${m.invoice_id}`} className="text-accent hover:underline">
                          {t.movements.invoice} <span className="ltr-value">{m.invoices?.invoice_number}</span>
                        </Link>
                      ) : null}
                      {(!m.invoice_id || m.movement_type === "cancellation") && (
                        <span className="block text-ink-soft">{movementReason(m, t)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} basePath="/movements" params={{ type: type || undefined }} t={t} />
      </Card>
    </>
  );
}
