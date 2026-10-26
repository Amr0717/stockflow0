"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Sends a picture of the invoice to WhatsApp (the picture only, no text).
 *
 * Phones and computers both use the system share menu (Web Share API): on
 * Windows that is the Windows "Share" window, where the WhatsApp app is listed;
 * choosing it opens the app with the picture attached and lets the owner pick
 * the chats to send it to.
 *
 * Browsers without file sharing: the picture is copied (or downloaded) and the
 * WhatsApp app is opened, ready to paste with Ctrl+V.
 *
 * The picture is prepared when the page opens, because share menus only open
 * straight after a click.
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
  onInfo: (result: { ok: boolean; text: string } | null) => void;
}) {
  const prepared = useRef<File | null>(null);
  const pending = useRef<Promise<File | null> | null>(null);
  const [ready, setReady] = useState(false);

  const render = (): Promise<File | null> => {
    pending.current ??= (async () => {
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
        prepared.current = blob ? new File([blob], fileName, { type: "image/png" }) : null;
        return prepared.current;
      } catch (err) {
        console.error("Could not prepare the invoice image", err);
        pending.current = null; // allow a retry on click
        return null;
      }
    })();
    return pending.current;
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
    onInfo(null);
    // Use the prepared picture without awaiting, so the share menu still
    // counts as "right after the click".
    const file = prepared.current ?? (await render());
    if (!file) {
      onInfo({ ok: false, text: t.errors.unknown });
      return;
    }

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        // AbortError = the share menu was closed on purpose.
        if ((err as Error)?.name === "AbortError") return;
      }
    }

    // No file sharing in this browser: copy (or download) and open the app.
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
      onInfo({ ok: true, text: t.invoices.whatsappCopied });
    } catch {
      download(file);
      onInfo({ ok: true, text: t.invoices.whatsappDownloaded });
    }
    window.location.assign("whatsapp://send");
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
