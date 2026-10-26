"use client";

import { useActionState, useRef, useState } from "react";
import type { FormState } from "@/app/(app)/products/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { parsePositiveInt } from "@/lib/numbers";

export function StockAdjustForm({
  action,
  currentQuantity,
  t,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  currentQuantity: number;
  t: Dictionary;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [type, setType] = useState(state.values?.type ?? "restock");
  const [direction, setDirection] = useState("increase");
  const [preview, setPreview] = useState<{ before: number; after: number } | null>(null);
  const err = state.fieldErrors ?? {};

  // First submit opens a confirmation showing before -> after.
  // Invalid input is sent straight to the server action, which returns field errors.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    const fd = new FormData(e.currentTarget);
    const amount = parsePositiveInt(String(fd.get("amount") ?? ""));
    if (amount === null || !String(fd.get("reason") ?? "").trim()) return;
    e.preventDefault();
    const delta = type === "adjustment" && direction === "decrease" ? -amount : amount;
    setPreview({ before: currentQuantity, after: currentQuantity + delta });
    setConfirming(true);
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      className="space-y-4"
      noValidate
      key={state.ok ? state.message : "form"}
    >
      {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.stock.type} htmlFor="type" error={err.type}>
          <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="restock">{t.stock.restock}</option>
            <option value="adjustment">{t.stock.adjustment}</option>
          </Select>
        </Field>
        {type === "adjustment" ? (
          <Field label={t.stock.direction} htmlFor="direction">
            <Select id="direction" name="direction" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="increase">{t.stock.increase}</option>
              <option value="decrease">{t.stock.decrease}</option>
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="direction" value="increase" />
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field label={t.stock.amount} htmlFor="amount" error={err.amount}>
          <Input
            id="amount"
            name="amount"
            dir="ltr"
            inputMode="numeric"
            defaultValue={state.values?.amount}
            aria-invalid={Boolean(err.amount)}
          />
        </Field>
        <Field label={t.stock.reason} htmlFor="reason" error={err.reason}>
          <Input
            id="reason"
            name="reason"
            maxLength={500}
            placeholder={t.stock.reasonPlaceholder}
            defaultValue={state.values?.reason}
            aria-invalid={Boolean(err.reason)}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? t.common.saving : t.stock.submit}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t.stock.confirmTitle}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        pending={pending}
        tone={preview && preview.after < 0 ? "danger" : "primary"}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          confirmedRef.current = true;
          formRef.current?.requestSubmit();
        }}
      >
        {preview && <p>{fill(t.stock.confirmBody, { before: preview.before, after: preview.after })}</p>}
      </ConfirmDialog>
    </form>
  );
}
