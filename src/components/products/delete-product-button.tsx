"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteProductAction } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { PinConfirmDialog } from "./pin-confirm-dialog";

export function DeleteProductButton({
  productId,
  t,
  size = "md",
}: {
  productId: string;
  t: Dictionary;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={size === "sm" ? "ghost" : "secondary"} size={size} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden className="size-4 text-danger" />
        {t.products.delete}
      </Button>
      {open && (
        <PinConfirmDialog
          title={t.products.deleteConfirmTitle}
          confirmLabel={t.products.delete}
          tone="danger"
          t={t}
          onConfirm={(pin) => deleteProductAction(productId, pin)}
          onDone={(res) => {
            setOpen(false);
            // Back to the inventory, which shows the outcome.
            if (res?.removed) router.push(`/products?removed=${res.removed}`);
          }}
        >
          <p>{t.products.deleteConfirmBody}</p>
        </PinConfirmDialog>
      )}
    </>
  );
}
