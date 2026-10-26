"use client";

import { useActionState } from "react";
import { signInAction, type LoginState } from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function LoginForm({
  labels,
}: {
  labels: { email: string; password: string; submit: string; submitting: string };
}) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label={labels.email} htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={Boolean(state.error)}
        />
      </Field>
      <Field label={labels.password} htmlFor="password">
        <Input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
