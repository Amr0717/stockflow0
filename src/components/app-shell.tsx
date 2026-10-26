"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Boxes,
  FilePlus2,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { LanguageSwitch } from "@/components/language-switch";
import { cn } from "@/lib/cn";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type NavKey = "dashboard" | "products" | "invoices" | "newInvoice" | "movements" | "settings";

const NAV: { key: NavKey; href: string; icon: typeof Boxes }[] = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "products", href: "/products", icon: Boxes },
  { key: "newInvoice", href: "/invoices/new", icon: FilePlus2 },
  { key: "invoices", href: "/invoices", icon: FileText },
  { key: "movements", href: "/movements", icon: History },
  { key: "settings", href: "/settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/invoices") return pathname.startsWith("/invoices") && pathname !== "/invoices/new";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  t,
  locale,
  email,
  businessName,
  children,
}: {
  t: Dictionary;
  locale: "ar" | "en";
  email: string;
  businessName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // The drawer remembers which page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const nav = (
    <nav aria-label={t.app.name} className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map(({ key, href, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              active ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-subtle hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-[18px] shrink-0" />
            {t.nav[key]}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="space-y-1 border-t border-line p-3">
      <LanguageSwitch locale={locale} label={t.nav.language} ariaLabel={t.nav.languageLabel} className="w-full justify-start" />
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-soft hover:bg-subtle hover:text-ink"
        >
          <LogOut aria-hidden className="size-4 rtl:rotate-180" />
          {t.nav.signOut}
        </button>
      </form>
      <p className="truncate px-3 pt-1 text-xs text-ink-muted" title={email}>
        {email}
      </p>
    </div>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
        <Boxes aria-hidden className="size-[18px]" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[15px] font-semibold text-ink">{t.app.name}</span>
        <span className="block truncate text-xs text-ink-muted">{businessName || t.app.tagline}</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-line bg-surface lg:flex">
        <div className="flex h-16 items-center border-b border-line px-5">{brand}</div>
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t.nav.openMenu}
          aria-expanded={open}
          aria-controls="mobile-drawer"
          className="flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-subtle"
        >
          <Menu aria-hidden className="size-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div
            id="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t.app.name}
            className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.nav.closeMenu}
                className="flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-subtle"
                autoFocus
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      <main className="print-shell min-w-0 flex-1 px-4 pt-5 pb-24 sm:px-6 lg:px-8 lg:pt-8 lg:pb-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {/* Mobile bottom navigation for the daily workflow */}
      <nav
        aria-label={t.app.tagline}
        className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.filter((n) => ["dashboard", "products", "newInvoice", "invoices"].includes(n.key)).map(({ key, href, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                active ? "text-accent" : "text-ink-muted",
              )}
            >
              <Icon aria-hidden className="size-5" />
              {t.nav[key]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
