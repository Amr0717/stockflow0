"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Sends a picture of the invoice to WhatsApp (the picture only, no text).
 *  - Phones/tablets: the system share sheet with the PNG, where WhatsApp is
 *    one tap away.
 *  - Computers: copies the PNG to the clipboard (or downloads it if copying
 *    is not allowed) and opens WhatsApp Web, ready to paste with Ctrl+V.
 * The picture is prepared when the page opens, because share sheets only
 * open straight after a click.
 */
export function WhatsAppButton({
  documentId,
  fileName,
  t,
  onInfo,
}: {
  documentId: string;
  fileName: string;
  t: Dictionary;
  onInfo: (result: { ok: boolean; text: string }) => void;
}) {
  const image = useRef<Promise<File | null> | null>(null);
  const [ready, setReady] = useState(false);

  const render = (): Promise<File | null> => {
    image.current ??= (async () => {
      try {
        await document.fonts.ready;
        const node = document.getElementById(documentId);
        if (!node) return null;
        const { toBlob } = await import("html-to-image");
        const blob = await toBlob(node, {
          pixelRatio: 2,
          backgroundColor: "#ffffff",
          cacheBust: true,
          // The on-screen centring margin would otherwise shift the picture sideways.
          style: { margin: "0" },
        });
        return blob ? new File([blob], fileName, { type: "image/png" }) : null;
      } catch (err) {
        console.error("Could not prepare the invoice image", err);
        image.current = null; // allow a retry on click
        return null;
      }
    })();
    return image.current;
  };

  useEffect(() => {
    let cancelled = false;
    render().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, fileName]);

  async function send() {
    const mobile = window.matchMedia("(pointer: coarse)").matches;
    // Open the tab inside the click, before any await, so it is not blocked.
    if (!mobile) window.open("https://web.whatsapp.com/", "_blank", "noopener,noreferrer");

    const file = await render();
    if (!file) {
      onInfo({ ok: false, text: t.errors.unknown });
      return;
    }

    if (mobile && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        // AbortError = the share sheet was closed; anything else: save the picture instead.
        if ((err as Error)?.name !== "AbortError") download(file);
      }
      return;
    }

    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
      onInfo({ ok: true, text: t.invoices.whatsappCopied });
    } catch {
      download(file);
      onInfo({ ok: true, text: t.invoices.whatsappDownloaded });
    }
  }

  function download(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <Button onClick={send} className="bg-[#1f9d55] hover:bg-[#178246]" aria-busy={!ready}>
      <MessageCircle aria-hidden className="size-4" />
      {t.invoices.whatsapp}
    </Button>
  );
}
