"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { CURRENCIES, CURRENCY_SYMBOLS } from "@/lib/numbers";
import type { OwnerSettings } from "@/lib/types";
import { saveSettingsAction, type SettingsState } from "./actions";

export function SettingsForm({ settings, t, locale }: { settings: OwnerSettings; t: Dictionary; locale: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettingsAction, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6" noValidate>
      <Card>
        <CardHeader title={t.settings.business} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label={t.settings.businessName} htmlFor="business_name">
            <Input id="business_name" name="business_name" maxLength={200} defaultValue={settings.business_name} />
          </Field>
          <Field label={t.settings.phone} htmlFor="business_phone" optionalLabel={t.common.optional}>
            <Input id="business_phone" name="business_phone" dir="ltr" maxLength={50} defaultValue={settings.business_phone} />
          </Field>
          <Field label={t.settings.address} htmlFor="business_address" optionalLabel={t.common.optional} className="sm:col-span-2">
            <Textarea id="business_address" name="business_address" rows={2} maxLength={500} defaultValue={settings.business_address} />
          </Field>
          <Field label={t.settings.taxId} htmlFor="business_tax_id" optionalLabel={t.common.optional}>
            <Input id="business_tax_id" name="business_tax_id" dir="ltr" maxLength={50} defaultValue={settings.business_tax_id} />
          </Field>
          <Field label={t.settings.invoicePrefix} htmlFor="invoice_prefix" error={err.invoice_prefix}>
            <Input id="invoice_prefix" name="invoice_prefix" dir="ltr" maxLength={12} defaultValue={settings.invoice_prefix} />
          </Field>
          <Field label={t.settings.footer} htmlFor="invoice_footer" optionalLabel={t.common.optional} className="sm:col-span-2">
            <Input id="invoice_footer" name="invoice_footer" maxLength={500} defaultValue={settings.invoice_footer} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={t.settings.preferences} />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label={t.settings.language} htmlFor="locale" error={err.locale}>
            <Select id="locale" name="locale" defaultValue={locale}>
              <option value="ar">{t.settings.arabic}</option>
              <option value="en">{t.settings.english}</option>
            </Select>
          </Field>
          <Field label={t.settings.currency} htmlFor="currency_code" hint={t.settings.currencyHint} error={err.currency_code}>
            <Select id="currency_code" name="currency_code" defaultValue={settings.currency_code}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_SYMBOLS[c]} {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.settings.lowStockDefault} htmlFor="default_low_stock_threshold" error={err.default_low_stock_threshold}>
            <Input
              id="default_low_stock_threshold"
              name="default_low_stock_threshold"
              dir="ltr"
              inputMode="numeric"
              defaultValue={String(settings.default_low_stock_threshold)}
            />
          </Field>
          <Field label={t.settings.timezone} htmlFor="timezone">
            <Input id="timezone" value={settings.timezone} dir="ltr" disabled readOnly />
          </Field>
        </div>
      </Card>

      {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.common.save}
        </Button>
      </div>
    </form>
  );
}
