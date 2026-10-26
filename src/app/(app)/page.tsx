import Link from "next/link";
import { AlertTriangle, Boxes, FilePlus2, FileText, History, Package } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Delta, InvoiceStatusBadge, MovementTypeBadge, StockLevel } from "@/components/status";
import { getSettings, requireUser } from "@/lib/data";
import { formatDateTime } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney, formatNumber } from "@/lib/numbers";
import type { Invoice, Product, StockMovement } from "@/lib/types";

type Stats = { active_products: number; total_units: number; issued_invoices: number; low_stock: number };

export default async function DashboardPage() {
  const { supabase } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);

  // All numbers come from live database queries (RLS limits them to the owner).
  const [statsRes, invoicesRes, movementsRes, lowRes] = await Promise.all([
    supabase.rpc("get_dashboard_stats"),
    supabase
      .from("invoices")
      .select("id, invoice_number, status, customer_name, total_minor, currency_code, issued_at, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("stock_movements")
      .select("id, movement_type, delta, quantity_after, created_at, product_id, products(sku, name)")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.rpc("get_low_stock_products", { p_limit: 8 }),
  ]);

  const error = statsRes.error ?? invoicesRes.error ?? movementsRes.error ?? lowRes.error;
  if (error) throw new Error(error.message);

  const stats = statsRes.data as Stats;
  const invoices = (invoicesRes.data ?? []) as Invoice[];
  const movements = (movementsRes.data ?? []) as unknown as StockMovement[];
  const low = (lowRes.data ?? []) as Product[];
  const tz = settings.timezone;

  const cards = [
    { label: t.dashboard.activeModels, value: stats.active_products, icon: Package, href: "/products" },
    { label: t.dashboard.totalUnits, value: stats.total_units, icon: Boxes, href: "/products" },
    { label: t.dashboard.issuedInvoices, value: stats.issued_invoices, icon: FileText, href: "/invoices?status=issued" },
    {
      label: t.dashboard.lowStock,
      value: stats.low_stock,
      icon: AlertTriangle,
      href: "/products?sort=quantity&dir=asc",
      warn: stats.low_stock > 0,
    },
  ];

  return (
    <>
      <PageHeader
        title={t.dashboard.title}
        actions={
          <ButtonLink href="/invoices/new">
            <FilePlus2 aria-hidden className="size-4" />
            {t.nav.newInvoice}
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, href, warn }) => (
          <Link
            key={label}
            href={href}
            className="group rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong sm:p-5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-ink-muted sm:text-sm">{label}</p>
              <Icon aria-hidden className={`size-4 shrink-0 ${warn ? "text-warning" : "text-ink-muted"}`} />
            </div>
            <p className={`ltr-value mt-2 text-2xl font-semibold sm:text-3xl ${warn ? "text-warning" : "text-ink"}`}>
              {formatNumber(value, locale)}
            </p>
          </Link>
        ))}
      </div>

      {stats.active_products === 0 && (
        <Card className="mt-6">
          <EmptyState
            icon={Package}
            title={t.dashboard.quickStart}
            action={<ButtonLink href="/products/new">{t.products.add}</ButtonLink>}
          />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title={t.dashboard.recentInvoices}
            action={
              <Link href="/invoices" className="text-sm font-medium text-accent hover:underline">
                {t.common.viewAll}
              </Link>
            }
          />
          {invoices.length === 0 ? (
            <EmptyState icon={FileText} title={t.dashboard.noInvoices} />
          ) : (
            <ul className="divide-y divide-line">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <Link href={`/invoices/${inv.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle/60">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {inv.invoice_number ? <span className="ltr-value">{inv.invoice_number}</span> : t.invoices.draft}
                        {inv.customer_name && <span className="text-ink-muted"> · {inv.customer_name}</span>}
                      </p>
                      <p className="text-xs text-ink-muted">{formatDateTime(inv.issued_at ?? inv.created_at, locale, tz)}</p>
                    </div>
                    <InvoiceStatusBadge status={inv.status} t={t} />
                    <span className="ltr-value w-24 text-end text-sm font-semibold">
                      {formatMoney(inv.total_minor, inv.currency_code, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={t.dashboard.lowStockList}
            action={
              <Link href="/products?sort=quantity&dir=asc" className="text-sm font-medium text-accent hover:underline">
                {t.common.viewAll}
              </Link>
            }
          />
          {low.length === 0 ? (
            <EmptyState icon={Package} title={t.dashboard.noLowStock} />
          ) : (
            <ul className="divide-y divide-line">
              {low.map((p) => (
                <li key={p.id}>
                  <Link href={`/products/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-subtle/60">
                    <div className="min-w-0">
                      <p className="ltr-value truncate text-sm font-medium">{p.sku}</p>
                      <p className="truncate text-xs text-ink-muted">{p.name}</p>
                    </div>
                    <StockLevel quantity={p.quantity_on_hand} threshold={p.low_stock_threshold} t={t} locale={locale} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={t.dashboard.recentMovements}
          action={
            <Link href="/movements" className="text-sm font-medium text-accent hover:underline">
              {t.common.viewAll}
            </Link>
          }
        />
        {movements.length === 0 ? (
          <EmptyState icon={History} title={t.dashboard.noMovements} />
        ) : (
          <ul className="divide-y divide-line">
            {movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <MovementTypeBadge type={m.movement_type} t={t} />
                <Link href={`/products/${m.product_id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                  <span className="ltr-value font-medium">{m.products?.sku}</span>
                  <span className="text-ink-muted"> · {m.products?.name}</span>
                </Link>
                <Delta value={m.delta} />
                <span className="text-xs text-ink-muted">{formatDateTime(m.created_at, locale, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
