"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FileCheck2, Loader2, Save, Search, Trash2 } from "lucide-react";
import {
  deleteDraftAction,
  issueInvoiceAction,
  saveDraftAction,
  searchProductsAction,
  type ProductOption,
} from "@/app/(app)/invoices/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { formatMoney, lineTotalMinor, minorToInput, parseMoneyToMinor, parsePositiveInt, sumMinor } from "@/lib/numbers";

export type EditorLine = {
  key: string;
  product_id: string;
  sku: string;
  name: string;
  available: number;
  quantity: string;
  unit_price: string;
};

type Props = {
  t: Dictionary;
  locale: "ar" | "en";
  currency: string;
  invoiceId: string | null;
  initialCustomer: string;
  initialNotes: string;
  initialLines: EditorLine[];
  initialMessage?: string;
};

let keySeq = 0;
const newKey = () => `l${++keySeq}-${Date.now()}`;

export function InvoiceEditor({
  t,
  locale,
  currency,
  invoiceId: initialId,
  initialCustomer,
  initialNotes,
  initialLines,
  initialMessage,
}: Props) {
  const router = useRouter();
  const [invoiceId, setInvoiceId] = useState<string | null>(initialId);
  const [customer, setCustomer] = useState(initialCustomer);
  const [notes, setNotes] = useState(initialNotes);
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(
    initialMessage ? { tone: "success", text: initialMessage } : null,
  );
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const focusQtyFor = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false); // blocks double submissions before React re-renders

  // ---- totals (exact integer minor units) ----
  const parsed = useMemo(
    () =>
      lines.map((l) => {
        const qty = parsePositiveInt(l.quantity);
        const price = parseMoneyToMinor(l.unit_price);
        return {
          qty,
          price,
          total: qty !== null && price !== null ? lineTotalMinor(qty, price) : null,
          short: qty !== null && qty > l.available,
        };
      }),
    [lines],
  );
  // Same product on several lines: compare the combined quantity with stock.
  const requestedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    lines.forEach((l, i) => map.set(l.product_id, (map.get(l.product_id) ?? 0) + (parsed[i].qty ?? 0)));
    return map;
  }, [lines, parsed]);
  const allValid = lines.length > 0 && parsed.every((p) => p.total !== null);
  const total = allValid ? sumMinor(parsed.map((p) => p.total!)) : null;
  const anyShort = lines.some((l) => (requestedByProduct.get(l.product_id) ?? 0) > l.available);

  // ---- line editing ----
  function addProduct(p: ProductOption) {
    setMessage(null);
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.product_id === p.id);
      if (existing >= 0) {
        // Adding the same SKU again increases its quantity instead of a new line.
        return prev.map((l, i) => {
          if (i !== existing) return l;
          const q = parsePositiveInt(l.quantity) ?? 0;
          return { ...l, quantity: String(q + 1) };
        });
      }
      return [
        ...prev,
        {
          key: newKey(),
          product_id: p.id,
          sku: p.sku,
          name: p.name,
          available: p.quantity_on_hand,
          quantity: "1",
          unit_price: minorToInput(p.unit_price_minor),
        },
      ];
    });
    focusQtyFor.current = p.id;
  }

  // After a product is added, jump to its quantity field (fast keyboard workflow).
  useEffect(() => {
    if (!focusQtyFor.current) return;
    const el = document.querySelector<HTMLInputElement>(`[data-qty-for="${focusQtyFor.current}"]`);
    focusQtyFor.current = null;
    el?.focus();
    el?.select();
  }, [lines]);

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setMessage(null);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setMessage(null);
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  // ---- server calls ----
  async function saveDraft() {
    const res = await saveDraftAction({
      invoiceId,
      customerName: customer,
      notes,
      lines: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price: l.unit_price })),
    });
    if (res.ok && res.invoiceId) setInvoiceId(res.invoiceId);
    return res;
  }

  function onSaveDraft() {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const isNew = invoiceId === null;
        const res = await saveDraft();
        if (res.ok && isNew && res.invoiceId) {
          // Open the saved draft at its own address (refresh-safe).
          router.replace(`/invoices/${res.invoiceId}?saved=1`);
          return;
        }
        setMessage({ tone: res.ok ? "success" : "danger", text: res.message ?? t.errors.unknown });
      } catch {
        setMessage({ tone: "danger", text: t.errors.network });
      } finally {
        busy.current = false;
      }
    });
  }

  function onIssue() {
    if (busy.current || total === null) return;
    busy.current = true;
    startTransition(async () => {
      try {
        // 1) Save the draft exactly as shown (no stock change).
        const saved = await saveDraft();
        if (!saved.ok || !saved.invoiceId) {
          setMessage({ tone: "danger", text: saved.message ?? t.errors.unknown });
          return;
        }
        // 2) Issue it in one atomic database transaction, confirming the reviewed total.
        const issued = await issueInvoiceAction(saved.invoiceId, total);
        if (!issued.ok) {
          setMessage({ tone: "danger", text: issued.message ?? t.errors.unknown });
          return;
        }
        router.replace(`/invoices/${saved.invoiceId}?issued=1`);
        router.refresh();
      } catch {
        setMessage({ tone: "danger", text: t.errors.network });
      } finally {
        busy.current = false;
        setConfirmIssue(false);
      }
    });
  }

  function onDelete() {
    if (!invoiceId || busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const res = await deleteDraftAction(invoiceId);
        if (res && !res.ok) setMessage({ tone: "danger", text: res.message ?? t.errors.unknown });
      } finally {
        busy.current = false;
        setConfirmDelete(false);
      }
    });
  }

  const money = (minor: number) => formatMoney(minor, currency, locale);

  return (
    <div className="space-y-6">
      <Alert tone="info">{t.invoices.draftNotice}</Alert>

      <Card>
        <CardHeader title={t.invoices.items} />
        <div className="border-b border-line p-4">
          <ProductSearch t={t} locale={locale} currency={currency} onPick={addProduct} />
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-muted">{t.invoices.noLines}</p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((line, i) => {
              const p = parsed[i];
              const combined = requestedByProduct.get(line.product_id) ?? 0;
              const short = combined > line.available;
              return (
                <li key={line.key} className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_8rem_8rem_2.5rem] sm:items-center sm:px-5">
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <p className="ltr-value truncate font-semibold">{line.sku}</p>
                    <p className="truncate text-sm text-ink-soft">{line.name}</p>
                    <p className={cn("text-xs", short ? "font-medium text-danger" : "text-ink-muted")}>
                      {short
                        ? fill(t.invoices.notEnough, { available: line.available })
                        : `${t.invoices.available}: ${line.available}`}
                    </p>
                  </div>
                  <div>
                    <label htmlFor={`qty-${line.key}`} className="mb-1 block text-xs text-ink-muted sm:sr-only">
                      {t.invoices.quantity}
                    </label>
                    <Input
                      id={`qty-${line.key}`}
                      data-qty-for={line.product_id}
                      dir="ltr"
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      aria-invalid={p.qty === null || short}
                      className="text-center"
                    />
                  </div>
                  <div>
                    <label htmlFor={`price-${line.key}`} className="mb-1 block text-xs text-ink-muted sm:sr-only">
                      {t.invoices.unitPrice}
                    </label>
                    <Input
                      id={`price-${line.key}`}
                      dir="ltr"
                      inputMode="decimal"
                      value={line.unit_price}
                      onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                      aria-invalid={p.price === null}
                      className="text-end"
                    />
                  </div>
                  <div className="flex items-center justify-between sm:block sm:text-end">
                    <span className="text-xs text-ink-muted sm:hidden">{t.invoices.lineTotal}</span>
                    <span className="ltr-value font-semibold">{p.total === null ? "—" : money(p.total)}</span>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      aria-label={`${t.invoices.remove} ${line.sku}`}
                      className="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-subtle/60 px-5 py-4">
          <span className="text-sm font-medium text-ink-soft">{t.invoices.total}</span>
          <span className="ltr-value text-xl font-semibold">{total === null ? "—" : money(total)}</span>
        </div>
        <p className="px-5 pb-4 pt-2 text-xs text-ink-muted">{t.invoices.pricesNote}</p>
      </Card>

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.invoices.customer} htmlFor="customer" optionalLabel={t.common.optional}>
            <Input
              id="customer"
              value={customer}
              maxLength={200}
              placeholder={t.invoices.customerPlaceholder}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </Field>
          <Field label={t.invoices.notes} htmlFor="notes" optionalLabel={t.common.optional}>
            <Textarea id="notes" value={notes} rows={1} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Card>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {invoiceId && (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={pending} className="text-danger hover:text-danger">
              <Trash2 aria-hidden className="size-4" />
              {t.invoices.deleteDraft}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={onSaveDraft} disabled={pending || lines.length === 0}>
            <Save aria-hidden className="size-4" />
            {t.invoices.saveDraft}
          </Button>
          <Button onClick={() => setConfirmIssue(true)} disabled={pending || !allValid || anyShort}>
            {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <FileCheck2 aria-hidden className="size-4" />}
            {pending ? t.invoices.issuing : t.invoices.issue}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmIssue}
        title={t.invoices.issueConfirmTitle}
        confirmLabel={pending ? t.invoices.issuing : t.invoices.issue}
        cancelLabel={t.common.cancel}
        pending={pending}
        onClose={() => setConfirmIssue(false)}
        onConfirm={onIssue}
      >
        <p>{fill(t.invoices.issueConfirmBody, { count: lines.length, total: total === null ? "—" : money(total) })}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        title={t.invoices.deleteDraftConfirmTitle}
        confirmLabel={t.invoices.deleteDraft}
        cancelLabel={t.common.cancel}
        tone="danger"
        pending={pending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
      >
        <p>{t.invoices.deleteDraftConfirmBody}</p>
      </ConfirmDialog>
    </div>
  );
}

/** Type-ahead product finder. Enter adds the first (best) match. */
function ProductSearch({
  t,
  locale,
  currency,
  onPick,
}: {
  t: Dictionary;
  locale: "ar" | "en";
  currency: string;
  onPick: (p: ProductOption) => void;
}) {
  const [query, setQuery] = useState("");
  // Results remember which text they belong to, so Enter never picks a stale match.
  const [found, setFound] = useState<{ query: string; rows: ProductOption[] }>({ query: "\u0000", rows: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const requestId = useRef(0);
  const fresh = found.query === query;
  const results = fresh ? found.rows : [];
  const loading = !fresh;

  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const rows = await searchProductsAction(query);
      if (id === requestId.current) {
        setFound({ query, rows });
        setActive(0);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function pick(p: ProductOption) {
    onPick(p);
    setQuery("");
    setOpen(false);
  }

  async function pickBestMatch() {
    if (fresh) {
      if (results[active]) pick(results[active]);
      return;
    }
    // Enter pressed before the search finished: search now and take the best match.
    const typed = query;
    const rows = await searchProductsAction(typed);
    if (rows[0] && typed === query) pick(rows[0]);
  }

  return (
    <div className="relative">
      <label htmlFor="product-search" className="mb-1.5 block text-sm font-medium">
        {t.invoices.addProduct}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-ink-muted" />
        <Input
          id="product-search"
          role="combobox"
          aria-expanded={open}
          aria-controls="product-results"
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `opt-${results[active].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder="SKU…"
          className="ps-9"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void pickBestMatch();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {loading && <Loader2 aria-hidden className="absolute top-1/2 end-3 size-4 -translate-y-1/2 animate-spin text-ink-muted" />}
      </div>
      <p className="mt-1 text-xs text-ink-muted">{t.invoices.addProductHint}</p>

      {open && (
        <ul
          id="product-results"
          role="listbox"
          className="absolute inset-x-0 top-[4.75rem] z-20 max-h-80 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {results.length === 0 && !loading ? (
            <li className="px-3 py-3 text-sm text-ink-muted">{t.invoices.noProductFound}</li>
          ) : (
            results.map((p, i) => (
              <li
                key={p.id}
                id={`opt-${p.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm",
                  i === active && "bg-accent-soft",
                )}
              >
                <span className="min-w-0">
                  <span className="ltr-value block truncate font-semibold">{p.sku}</span>
                  <span className="block truncate text-xs text-ink-muted">{p.name}</span>
                </span>
                <span className="shrink-0 text-end text-xs">
                  <span className="ltr-value block font-medium">{formatMoney(p.unit_price_minor, currency, locale)}</span>
                  <span className={cn("block", p.quantity_on_hand === 0 ? "text-danger" : "text-ink-muted")}>
                    {t.invoices.available}: <span className="ltr-value">{p.quantity_on_hand}</span>
                  </span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
