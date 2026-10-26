"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { FormState } from "@/app/(app)/products/actions";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/field";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Confirmation dialog that asks for the management PIN. It stays open on a
 * wrong PIN so the owner can retry. Rendered only while open, so each use
 * starts with an empty PIN (and only one dialog exists in the page at a time).
 */
export function PinConfirmDialog({
  title,
  children,
  confirmLabel,
  tone,
  t,
  onConfirm,
  onDone,
}: {
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: ReactNode;
  tone: "primary" | "danger";
  t: Dictionary;
  onConfirm: (pin: string) => Promise<FormState>;
  onDone: (result: FormState | null) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    if (!pin.trim()) {
      setError(t.errors.pin_required);
      return;
    }
    startTransition(async () => {
      const res = await onConfirm(pin);
      if (res.ok) onDone(res);
      else {
        setError(res.message ?? t.errors.unknown);
        setPin("");
      }
    });
  };

  return (
    <ConfirmDialog
      open
      title={title}
      confirmLabel={confirmLabel}
      cancelLabel={t.common.cancel}
      tone={tone}
      pending={pending}
      onClose={() => onDone(null)}
      onConfirm={confirm}
    >
      {children}
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t.products.pin} htmlFor="manage-pin">
        <Input
          id="manage-pin"
          type="password"
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirm();
            }
          }}
          aria-invalid={Boolean(error)}
        />
      </Field>
    </ConfirmDialog>
  );
}
