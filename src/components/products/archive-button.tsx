"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useState, useTransition } from "react";
import { setArchivedAction } from "@/app/(app)/products/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export function ArchiveButton({ productId, archived, t }: { productId: string; archived: boolean; t: Dictionary }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {archived ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
        {archived ? t.products.restore : t.products.archive}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      <ConfirmDialog
        open={open}
        title={archived ? t.products.restoreConfirmTitle : t.products.archiveConfirmTitle}
        confirmLabel={archived ? t.products.restore : t.products.archive}
        cancelLabel={t.common.cancel}
        tone={archived ? "primary" : "danger"}
        pending={pending}
        onClose={() => setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const res = await setArchivedAction(productId, !archived);
            setError(res.ok ? null : (res.message ?? null));
            setOpen(false);
          })
        }
      >
        <p>{archived ? t.products.restoreConfirmBody : t.products.archiveConfirmBody}</p>
      </ConfirmDialog>
    </>
  );
}
