import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { email } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);
  return (
    <>
      <PageHeader title={t.settings.title} />
      <div className="max-w-3xl space-y-6">
        <SettingsForm key={JSON.stringify(settings)} settings={settings} t={t} locale={locale} />
        <Card>
          <CardHeader title={t.settings.account} />
          <p className="p-5 text-sm">
            <span className="text-ink-muted">{t.settings.signedInAs}: </span>
            <span className="ltr-value font-medium">{email}</span>
          </p>
        </Card>
      </div>
    </>
  );
}
