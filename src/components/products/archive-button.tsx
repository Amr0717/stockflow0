"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useState } from "react";
import { setArchivedAction } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { PinConfirmDialog } from "./pin-confirm-dialog";

export function ArchiveButton({ productId, archived, t }: { productId: string; archived: boolean; t: Dictionary }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {archived ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
        {archived ? t.products.restore : t.products.archive}
      </Button>
      {open && (
        <PinConfirmDialog
          title={archived ? t.products.restoreConfirmTitle : t.products.archiveConfirmTitle}
          confirmLabel={archived ? t.products.restore : t.products.archive}
          tone={archived ? "primary" : "danger"}
          t={t}
          onConfirm={(pin) => setArchivedAction(productId, !archived, pin)}
          onDone={() => setOpen(false)}
        >
          <p>{archived ? t.products.restoreConfirmBody : t.products.archiveConfirmBody}</p>
        </PinConfirmDialog>
      )}
    </>
  );
}
