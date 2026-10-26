"use client";

import { Languages } from "lucide-react";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/actions/locale";
import { cn } from "@/lib/cn";

export function LanguageSwitch({
  locale,
  label,
  ariaLabel,
  className,
}: {
  locale: "ar" | "en";
  label: string;
  ariaLabel: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={pending}
      onClick={() => startTransition(() => setLocaleAction(locale === "ar" ? "en" : "ar"))}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-soft hover:bg-subtle hover:text-ink disabled:opacity-60",
        className,
      )}
    >
      <Languages aria-hidden className="size-4" />
      <span lang={locale === "ar" ? "en" : "ar"}>{label}</span>
    </button>
  );
}
