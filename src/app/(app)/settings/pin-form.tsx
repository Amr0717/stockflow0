"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, PinInput } from "@/components/ui/field";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { setPinAction, type PinState } from "./actions";

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
              <PinInput id="current_pin" name="current_pin" aria-invalid={Boolean(err.current_pin)} />
            </Field>
          )}
          <Field label={t.settings.newPin} htmlFor="new_pin" hint={t.settings.pinFormatHint} error={err.new_pin}>
            <PinInput id="new_pin" name="new_pin" aria-invalid={Boolean(err.new_pin)} />
          </Field>
          <Field label={t.settings.confirmPin} htmlFor="confirm_pin" error={err.confirm_pin}>
            <PinInput id="confirm_pin" name="confirm_pin" aria-invalid={Boolean(err.confirm_pin)} />
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
