import type { Metadata } from "next";
import Image from "next/image";
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
          <Image
            src="/brand/sawalhi-fashion.jpg"
            alt=""
            width={160}
            height={160}
            priority
            className="mb-3 size-20 rounded-full object-cover shadow-sm ring-2 ring-[#d9b25f]"
          />
          <p className="text-lg font-bold text-[#3b2416]">{t.app.name}</p>
          <h1 className="mt-1 text-base font-semibold text-ink-soft">{t.auth.title}</h1>
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
