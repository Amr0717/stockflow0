import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { LanguageSwitch } from "@/components/language-switch";
import { getI18n } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Login" };

export default async function LoginPage() {
  const { t, locale } = await getI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="absolute top-4 end-4">
        <LanguageSwitch locale={locale} label={t.nav.language} ariaLabel={t.nav.languageLabel} />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
            <Boxes aria-hidden className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">{t.auth.title}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">{t.auth.subtitle}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <LoginForm
            labels={{
              email: t.auth.email,
              password: t.auth.password,
              submit: t.auth.submit,
              submitting: t.auth.submitting,
            }}
          />
        </div>
        <p className="mt-4 text-center text-xs text-ink-muted">{t.auth.noSignup}</p>
      </div>
    </main>
  );
}
