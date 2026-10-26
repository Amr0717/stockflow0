"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shown when a page cannot load its data. Bilingual because it cannot read the locale.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
      <AlertTriangle aria-hidden className="mx-auto size-8 text-danger" />
      <h1 className="mt-3 text-lg font-semibold">تعذّر تحميل الصفحة · Could not load this page</h1>
      <p className="mt-2 text-sm text-ink-muted">
        تحقق من الاتصال بقاعدة البيانات ثم حاول مرة أخرى. Check the database connection and try again.
      </p>
      <Button className="mt-5" onClick={() => retry()}>
        حاول مرة أخرى · Try again
      </Button>
    </div>
  );
}
