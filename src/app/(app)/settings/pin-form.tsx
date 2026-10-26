"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { setPinAction, type PinState } from "./actions";

const pinInput = { type: "password", dir: "ltr", inputMode: "numeric", autoComplete: "off", maxLength: 12 } as const;

export function PinForm({ hasPin, t }: { hasPin: boolean; t: Dictionary }) {
  const [state, action, pending] = useActionState<PinState, FormData>(setPinAction, {});
  const err = state.fieldErrors ?? {};
  const isSet = hasPin || Boolean(state.ok);
  return (
    <Card>
      <CardHeader title={t.settings.pinTitle} />
      {/* Re-mount after each response so the PIN inputs are always cleared. */}
      <form action={action} className="space-y-4 p-5" noValidate key={JSON.stringify(state)}>
        {state.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
        <p className="text-sm text-ink-soft">{isSet ? t.settings.pinIsSet : t.settings.pinNotSet}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {isSet && (
            <Field label={t.settings.currentPin} htmlFor="current_pin" error={err.current_pin}>
              <Input id="current_pin" name="current_pin" {...pinInput} aria-invalid={Boolean(err.current_pin)} />
            </Field>
          )}
          <Field label={t.settings.newPin} htmlFor="new_pin" hint={t.settings.pinFormatHint} error={err.new_pin}>
            <Input id="new_pin" name="new_pin" {...pinInput} aria-invalid={Boolean(err.new_pin)} />
          </Field>
          <Field label={t.settings.confirmPin} htmlFor="confirm_pin" error={err.confirm_pin}>
            <Input id="confirm_pin" name="confirm_pin" {...pinInput} aria-invalid={Boolean(err.confirm_pin)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? t.common.saving : t.settings.savePin}
          </Button>
        </div>
      </form>
    </Card>
  );
}
