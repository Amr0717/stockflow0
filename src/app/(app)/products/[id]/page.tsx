import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { ArchiveButton } from "@/components/products/archive-button";
import { DeleteProductButton } from "@/components/products/delete-product-button";
import { ProductForm } from "@/components/products/product-form";
import { StockAdjustForm } from "@/components/products/stock-adjust-form";
import { BeforeAfter, Delta, MovementTypeBadge, StockLevel, movementReason } from "@/components/status";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { formatDateTime } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { CURRENCY_SYMBOLS, minorToInput, type CurrencyCode } from "@/lib/numbers";
import type { Product, StockMovement } from "@/lib/types";
import { adjustStockAction, updateProductAction } from "../actions";

export const metadata: Metadata = { title: "Product" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();

  const { supabase } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);

  const [productRes, movesRes] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("stock_movements")
      .select("id, movement_type, delta, quantity_before, quantity_after, reason, created_at, invoice_id, invoices(invoice_number)")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (productRes.error) throw new Error(productRes.error.message);
  if (movesRes.error) throw new Error(movesRes.error.message);
  const product = productRes.data as Product | null;
  if (!product) notFound();
  const moves = (movesRes.data ?? []) as unknown as StockMovement[];
  const tz = settings.timezone;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="ltr-value">{product.sku}</span>
            {product.archived_at && <Badge>{t.products.archived}</Badge>}
          </span>
        }
        description={product.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <ArchiveButton productId={product.id} archived={Boolean(product.archived_at)} t={t} />
            {!product.archived_at && <DeleteProductButton productId={product.id} t={t} />}
          </div>
        }
      />

      {sp.created === "1" && <Alert tone="success" className="mb-4">{t.products.created_ok}</Alert>}

      <div className="grid gap-6 lg:grid-cols-5">
        <div id="edit" className="scroll-mt-20 space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title={t.products.editTitle} />
            <div className="p-5">
              <ProductForm
                action={updateProductAction.bind(null, product.id)}
                mode="edit"
                t={t}
                currencySymbol={CURRENCY_SYMBOLS[settings.currency_code as CurrencyCode] ?? settings.currency_code}
                initial={{
                  sku: product.sku,
                  name: product.name,
                  description: product.description ?? "",
                  price: minorToInput(product.unit_price_minor),
                  cost: product.cost_minor == null ? "" : minorToInput(product.cost_minor),
                  threshold: String(product.low_stock_threshold),
                }}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t.products.quantity} />
            <div className="space-y-4 p-5">
              <div className="text-3xl">
                <StockLevel quantity={product.quantity_on_hand} threshold={product.low_stock_threshold} t={t} locale={locale} />
              </div>
              <p className="text-xs text-ink-muted">{t.products.quantityLocked}</p>
              {!product.archived_at && (
                <StockAdjustForm
                  action={adjustStockAction.bind(null, product.id)}
                  currentQuantity={product.quantity_on_hand}
                  t={t}
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title={t.products.history} />
        {moves.length === 0 ? (
          <EmptyState icon={History} title={t.movements.empty} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-subtle/70 text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 text-start font-medium">{t.common.date}</th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.movements.type}</th>
                  <th scope="col" className="px-3 py-2.5 text-end font-medium">{t.movements.change}</th>
                  <th scope="col" className="px-3 py-2.5 text-end font-medium">{t.movements.beforeAfter}</th>
                  <th scope="col" className="px-5 py-2.5 text-start font-medium">{t.movements.reason}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-2.5 text-xs whitespace-nowrap text-ink-muted">{formatDateTime(m.created_at, locale, tz)}</td>
                    <td className="px-3 py-2.5"><MovementTypeBadge type={m.movement_type} t={t} /></td>
                    <td className="px-3 py-2.5 text-end"><Delta value={m.delta} /></td>
                    <td className="px-3 py-2.5 text-end"><BeforeAfter before={m.quantity_before} after={m.quantity_after} locale={locale} /></td>
                    <td className="px-5 py-2.5">
                      {m.invoice_id ? (
                        <Link href={`/invoices/${m.invoice_id}`} className="text-accent hover:underline">
                          <span className="ltr-value">{m.invoices?.invoice_number}</span>
                        </Link>
                      ) : (
                        movementReason(m, t)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
