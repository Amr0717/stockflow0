import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { buttonClass } from "@/components/ui/button";

/** Previous/next links that keep the current filters in the URL. */
export function Pagination({
  page,
  totalPages,
  basePath,
  params,
  t,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  params: Record<string, string | undefined>;
  t: Dictionary;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && sp.set(k, v));
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm" aria-label="Pagination">
      <span className="text-ink-muted">
        {t.common.page} <span className="ltr-value">{page}</span> {t.common.of} <span className="ltr-value">{totalPages}</span>
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>
            <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
            {t.common.previous}
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>
            {t.common.next}
            <ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
