import { AppShell } from "@/components/app-shell";
import { getSettings, requireUser } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { email } = await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);
  return (
    <AppShell t={t} locale={locale} email={email} businessName={settings.business_name}>
      {children}
    </AppShell>
  );
}
