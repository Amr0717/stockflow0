"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Ban, Printer } from "lucide-react";
import { cancelInvoiceAction } from "@/app/(app)/invoices/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/field";
import { fill, type Dictionary } from "@/lib/i18n/dictionaries";
import { WhatsAppButton } from "./whatsapp-button";

export function IssuedInvoiceActions({
  invoiceId,
  invoiceNumber,
  canCancel,
  t,
}: {
  invoiceId: string;
  invoiceNumber: string;
  canCancel: boolean;
  t: Dictionary;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = useRef(false);

  function cancel() {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const res = await cancelInvoiceAction(invoiceId, reason);
        setResult({ ok: res.ok, text: res.message ?? t.errors.unknown });
        if (res.ok) router.refresh();
      } catch {
        setResult({ ok: false, text: t.errors.network });
      } finally {
        busy.current = false;
        setOpen(false);
      }
    });
  }

  return (
    <div className="no-print space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t.invoices.print}
        </Button>
        <WhatsAppButton
          documentId="invoice-document"
          fileName={`${invoiceNumber || "invoice"}.png`}
          t={t}
          onInfo={setResult}
        />
        {canCancel && (
          <Button variant="secondary" onClick={() => setOpen(true)} className="text-danger">
            <Ban aria-hidden className="size-4" />
            {t.invoices.cancelInvoice}
          </Button>
        )}
      </div>
      {result && <Alert tone={result.ok ? "success" : "danger"}>{result.text}</Alert>}
      {canCancel && (
        <ConfirmDialog
          open={open}
          title={fill(t.invoices.cancelConfirmTitle, { number: invoiceNumber })}
          confirmLabel={t.invoices.cancelInvoice}
          cancelLabel={t.common.close}
          tone="danger"
          pending={pending}
          onClose={() => setOpen(false)}
          onConfirm={cancel}
        >
          <p>{t.invoices.cancelConfirmBody}</p>
          <label htmlFor="cancel-reason" className="sr-only">
            {t.invoices.cancelReason}
          </label>
          <Input
            id="cancel-reason"
            value={reason}
            maxLength={500}
            placeholder={t.invoices.cancelReasonPlaceholder}
            onChange={(e) => setReason(e.target.value)}
          />
        </ConfirmDialog>
      )}
    </div>
  );
}
