"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Sends the invoice to WhatsApp.
 *  - Phones/tablets: shares a PNG of the invoice (plus a text summary) through
 *    the system share sheet, where WhatsApp is one tap away.
 *  - Computers: opens WhatsApp with the text summary and downloads the PNG so
 *    it can be attached in the chat.
 * The image is prepared in the background when the page opens, because share
 * sheets only open straight after a click.
 */
export function WhatsAppButton({
  documentId,
  fileName,
  shareText,
  t,
  onInfo,
}: {
  documentId: string;
  fileName: string;
  shareText: string;
  t: Dictionary;
  onInfo: (text: string) => void;
}) {
  const image = useRef<File | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await document.fonts.ready;
        const node = document.getElementById(documentId);
        if (!node) return;
        const { toBlob } = await import("html-to-image");
        const blob = await toBlob(node, {
          pixelRatio: 2,
          backgroundColor: "#ffffff",
          cacheBust: true,
          // The on-screen centring margin would otherwise shift the picture sideways.
          style: { margin: "0" },
        });
        if (blob && !cancelled) image.current = new File([blob], fileName, { type: "image/png" });
      } catch (err) {
        console.error("Could not prepare the invoice image", err);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, fileName]);

  function send() {
    const file = image.current;
    const mobile = window.matchMedia("(pointer: coarse)").matches;
    if (file && mobile && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], text: shareText }).catch((err: unknown) => {
        // AbortError = the owner closed the share sheet; nothing to do.
        if ((err as Error)?.name !== "AbortError") openWhatsApp();
      });
      return;
    }
    openWhatsApp();
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      onInfo(t.invoices.whatsappDownloaded);
    }
  }

  function openWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer");
  }

  // Never blocked: until the picture is ready, a click sends the text summary only.
  return (
    <Button onClick={send} className="bg-[#1f9d55] hover:bg-[#178246]" aria-busy={!ready}>
      <MessageCircle aria-hidden className="size-4" />
      {t.invoices.whatsapp}
    </Button>
  );
}
