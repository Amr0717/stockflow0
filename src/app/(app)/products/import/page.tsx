import type { Metadata } from "next";
import { BulkImportForm } from "@/components/products/bulk-import-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Add many products" };

export default async function ImportProductsPage() {
  await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);
  return (
    <>
      <PageHeader title={t.import.title} />
      <Card className="max-w-5xl p-5 sm:p-6">
        <BulkImportForm t={t} currency={settings.currency_code} locale={locale} />
      </Card>
    </>
  );
}
