import Link from "next/link";
import type { Metadata } from "next";
import { Package, Pencil, Plus, Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { DeleteProductButton } from "@/components/products/delete-product-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StockLevel } from "@/components/status";
import { getSettings, requireUser } from "@/lib/data";
import { formatDateTime } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/numbers";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Product } from "@/lib/types";

export const metadata: Metadata = { title: "Inventory" };

const PAGE_SIZE = 25;
const SORTS = { sku: "sku", name: "name", quantity: "quantity_on_hand", updated: "updated_at" } as const;
type SortKey = keyof typeof SORTS;

/** Escapes user text for a PostgREST ilike filter inside double quotes. */
function likePattern(q: string) {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 100);
  const sort: SortKey = (Object.keys(SORTS) as SortKey[]).includes(one(sp.sort) as SortKey)
    ? (one(sp.sort) as SortKey)
    : "sku";
  const dir = one(sp.dir) === "desc" ? "desc" : "asc";
  const showArchived = one(sp.archived) === "1";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const removed = one(sp.removed);

  const { supabase } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);

  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .order(SORTS[sort], { ascending: dir === "asc" })
    .order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (!showArchived) query = query.is("archived_at", null);
  if (q) query = query.or(`sku.ilike.${likePattern(q)},name.ilike.${likePattern(q)}`);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const products = (data ?? []) as Product[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title={t.products.title}
        actions={
          <ButtonLink href="/products/new">
            <Plus aria-hidden className="size-4" />
            {t.products.add}
          </ButtonLink>
        }
      />

      {(removed === "deleted" || removed === "archived") && (
        <Alert tone="success" className="mb-4">
          {removed === "deleted" ? t.products.deleted_ok : t.products.deleted_archived_ok}
        </Alert>
      )}

      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4" role="search">
          <div className="relative min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              {t.common.search}
            </label>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-ink-muted" />
            <Input id="q" name="q" type="search" defaultValue={q} placeholder={t.products.searchPlaceholder} className="ps-9" autoComplete="off" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="sort" className="sr-only">
              {t.products.sortBy}
            </label>
            <Select id="sort" name="sort" defaultValue={sort} className="w-auto">
              <option value="sku">{t.products.sortBy}: {t.products.sortSku}</option>
              <option value="name">{t.products.sortBy}: {t.products.sortName}</option>
              <option value="quantity">{t.products.sortBy}: {t.products.sortQuantity}</option>
              <option value="updated">{t.products.sortBy}: {t.products.sortUpdated}</option>
            </Select>
            <label htmlFor="dir" className="sr-only">
              {t.products.sortBy}
            </label>
            <Select id="dir" name="dir" defaultValue={dir} className="w-auto">
              <option value="asc">{t.products.ascending}</option>
              <option value="desc">{t.products.descending}</option>
            </Select>
            <label className="flex h-10 items-center gap-2 px-1 text-sm text-ink-soft">
              <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} className="size-4 accent-[var(--color-accent)]" />
              {t.products.showArchived}
            </label>
            <Button type="submit" variant="secondary">
              {t.common.filter}
            </Button>
          </div>
        </form>

        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title={q ? t.products.noResults : t.products.empty}
            action={!q && <ButtonLink href="/products/new">{t.products.add}</ButtonLink>}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-subtle/70 text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 text-start font-medium">{t.products.sku}</th>
                    <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.products.name}</th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">{t.products.quantity}</th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">{t.products.price}</th>
                    <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.products.updated}</th>
                    <th scope="col" className="px-5 py-2.5 text-end font-medium">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-subtle/50">
                      <td className="px-5 py-3">
                        <Link href={`/products/${p.id}`} className="ltr-value font-semibold text-accent-ink hover:underline">
                          {p.sku}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <span className="me-2">{p.name}</span>
                        {p.archived_at && <Badge>{t.products.archived}</Badge>}
                      </td>
                      <td className="px-3 py-3 text-end">
                        <StockLevel quantity={p.quantity_on_hand} threshold={p.low_stock_threshold} t={t} locale={locale} />
                      </td>
                      <td className="ltr-value px-3 py-3 text-end">{formatMoney(p.unit_price_minor, settings.currency_code, locale)}</td>
                      <td className="px-3 py-3 text-xs text-ink-muted">{formatDateTime(p.updated_at, locale, settings.timezone)}</td>
                      <td className="px-5 py-2">
                        <RowActions productId={p.id} archived={Boolean(p.archived_at)} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-line md:hidden">
              {products.map((p) => (
                <li key={p.id} className="pb-2">
                  <Link href={`/products/${p.id}`} className="flex items-center justify-between gap-3 px-4 pt-3 pb-1 active:bg-subtle">
                    <div className="min-w-0">
                      <p className="ltr-value truncate font-semibold text-accent-ink">{p.sku}</p>
                      <p className="truncate text-sm text-ink-soft">
                        {p.name} {p.archived_at && <Badge>{t.products.archived}</Badge>}
                      </p>
                      <p className="ltr-value text-xs text-ink-muted">{formatMoney(p.unit_price_minor, settings.currency_code, locale)}</p>
                    </div>
                    <StockLevel quantity={p.quantity_on_hand} threshold={p.low_stock_threshold} t={t} locale={locale} />
                  </Link>
                  <div className="px-2">
                    <RowActions productId={p.id} archived={Boolean(p.archived_at)} t={t} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          basePath="/products"
          params={{ q: q || undefined, sort, dir, archived: showArchived ? "1" : undefined }}
          t={t}
        />
      </Card>
    </>
  );
}

/** Edit (opens the product's edit form) and delete, both guarded by the PIN. */
function RowActions({ productId, archived, t }: { productId: string; archived: boolean; t: Dictionary }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <ButtonLink href={`/products/${productId}#edit`} variant="ghost" size="sm">
        <Pencil aria-hidden className="size-4" />
        {t.common.edit}
      </ButtonLink>
      {!archived && <DeleteProductButton productId={productId} t={t} size="sm" />}
    </div>
  );
}
