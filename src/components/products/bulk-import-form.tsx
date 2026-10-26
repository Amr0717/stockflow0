"use client";

import { FileUp } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { importProductsAction, type FormState } from "@/app/(app)/products/actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { MAX_IMPORT_ROWS, parseImportText, rowIsValid, type ImportField, type ImportRow } from "@/lib/import";
import { formatMoney } from "@/lib/numbers";

export function BulkImportForm({ t, currency, locale }: { t: Dictionary; currency: string; locale: string }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<FormState | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => parseImportText(text), [text]);
  const bad = rows.filter((r) => !rowIsValid(r)).length;
  const tooMany = rows.length > MAX_IMPORT_ROWS;
  const canSubmit = rows.length > 0 && bad === 0 && !tooMany && !pending;

  const submit = () =>
    startTransition(async () => {
      const res = await importProductsAction(
        rows.map((r) => ({
          sku: r.sku,
          name: r.name,
          unit_price_minor: r.unit_price_minor!,
          quantity: r.quantity!,
          cost_minor: r.cost_minor,
        })),
      );
      setResult(res);
      if (res.ok) setText("");
    });

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-sm text-ink-soft">
        <p>{t.import.intro}</p>
        <p className="font-medium text-ink">{t.import.columns}</p>
        <p className="text-xs text-ink-muted">{t.import.headerNote}</p>
      </div>

      {result?.message && (
        <Alert tone={result.ok ? "success" : "danger"}>
          {result.message}
          {result.ok && (
            <ButtonLink href="/products" variant="secondary" size="sm" className="ms-3">
              {t.products.title}
            </ButtonLink>
          )}
        </Alert>
      )}

      <Field label={t.import.paste} htmlFor="import-text">
        <Textarea
          id="import-text"
          dir="auto"
          rows={8}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={"000123\tBlue shirt\t19.95\t10\n000124\tRed shirt\t21.50\t4"}
          className="font-mono text-xs"
        />
      </Field>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-accent-ink hover:underline">
        <FileUp aria-hidden className="size-4" />
        {t.import.chooseFile}
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setText(await file.text());
            setResult(null);
            e.target.value = "";
          }}
        />
      </label>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.import.empty}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{fill(t.import.rowsReady, { count: rows.length - bad })}</span>
            {bad > 0 && <span className="text-danger">{fill(t.import.rowsWithErrors, { count: bad })}</span>}
            {tooMany && <span className="text-danger">{fill(t.import.tooMany, { max: MAX_IMPORT_ROWS })}</span>}
          </div>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-subtle text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t.import.line}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t.products.sku}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t.products.name}</th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">{t.products.price}</th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">{t.products.quantity}</th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">{t.products.cost}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <PreviewRow key={r.line} row={r} t={t} currency={currency} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={!canSubmit}>
          {pending ? t.common.saving : fill(t.import.submit, { count: rows.length })}
        </Button>
      </div>
    </div>
  );
}

function PreviewRow({ row, t, currency, locale }: { row: ImportRow; t: Dictionary; currency: string; locale: string }) {
  const cell = (field: ImportField) => cn("px-3 py-1.5", row.errors.includes(field) && "bg-danger/10 text-danger");
  const money = (v: number | null) => (v == null ? "" : formatMoney(v, currency, locale));
  return (
    <tr className={cn(!rowIsValid(row) && "bg-danger/5")}>
      <td className="px-3 py-1.5 text-xs text-ink-muted">{row.line}</td>
      <td className={cn(cell("sku"), "ltr-value font-medium")}>
        {row.sku}
        {row.duplicate && <Badge tone="danger" className="ms-2">{t.import.duplicate}</Badge>}
      </td>
      <td className={cell("name")}>{row.name}</td>
      <td className={cn(cell("price"), "ltr-value text-end")}>{money(row.unit_price_minor)}</td>
      <td className={cn(cell("quantity"), "ltr-value text-end")}>{row.quantity}</td>
      <td className={cn(cell("cost"), "ltr-value text-end")}>{money(row.cost_minor)}</td>
    </tr>
  );
}
