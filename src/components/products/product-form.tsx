"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(app)/products/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type Values = {
  sku: string;
  name: string;
  description: string;
  price: string;
  cost: string;
  threshold: string;
  initial_quantity?: string;
};

export function ProductForm({
  action,
  initial,
  mode,
  t,
  currencySymbol,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial: Values;
  mode: "create" | "edit";
  t: Dictionary;
  currencySymbol: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = { ...initial, ...state.values };
  const err = state.fieldErrors ?? {};
  // Re-mount inputs after each server response so defaultValue reflects it.
  const formKey = JSON.stringify(state.values ?? initial);

  return (
    <form action={formAction} className="space-y-5" noValidate key={formKey}>
      {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.products.sku} htmlFor="sku" hint={t.products.skuHint} error={err.sku}>
          <Input
            id="sku"
            name="sku"
            dir="ltr"
            required
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            defaultValue={v.sku}
            aria-invalid={Boolean(err.sku)}
            className="font-medium"
          />
        </Field>
        <Field label={t.products.name} htmlFor="name" error={err.name}>
          <Input id="name" name="name" required maxLength={200} defaultValue={v.name} aria-invalid={Boolean(err.name)} />
        </Field>
      </div>

      <Field label={t.products.description} htmlFor="description" optionalLabel={t.common.optional}>
        <Textarea id="description" name="description" rows={2} maxLength={2000} defaultValue={v.description} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`${t.products.price} (${currencySymbol})`} htmlFor="price" error={err.price}>
          <Input
            id="price"
            name="price"
            dir="ltr"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={v.price}
            aria-invalid={Boolean(err.price)}
          />
        </Field>
        <Field
          label={`${t.products.cost} (${currencySymbol})`}
          htmlFor="cost"
          optionalLabel={t.common.optional}
          error={err.cost}
        >
          <Input id="cost" name="cost" dir="ltr" inputMode="decimal" placeholder="0.00" defaultValue={v.cost} aria-invalid={Boolean(err.cost)} />
        </Field>
        <Field label={t.products.threshold} htmlFor="threshold" error={err.threshold}>
          <Input
            id="threshold"
            name="threshold"
            dir="ltr"
            inputMode="numeric"
            defaultValue={v.threshold}
            aria-invalid={Boolean(err.threshold)}
          />
        </Field>
      </div>

      {mode === "create" && (
        <Field label={t.products.initialQuantity} htmlFor="initial_quantity" hint={t.products.quantityHint} error={err.initial_quantity}>
          <Input
            id="initial_quantity"
            name="initial_quantity"
            dir="ltr"
            inputMode="numeric"
            defaultValue={v.initial_quantity ?? "0"}
            aria-invalid={Boolean(err.initial_quantity)}
            className="sm:max-w-48"
          />
        </Field>
      )}

      {mode === "edit" && (
        <Field label={t.products.pin} htmlFor="pin" hint={t.products.pinHint} error={err.pin}>
          <Input
            id="pin"
            name="pin"
            type="password"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            required
            maxLength={12}
            aria-invalid={Boolean(err.pin)}
            className="sm:max-w-48"
          />
        </Field>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : mode === "create" ? t.products.add : t.common.save}
        </Button>
      </div>
    </form>
  );
}
