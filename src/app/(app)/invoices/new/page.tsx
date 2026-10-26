import type { Metadata } from "next";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  await requireUser();
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);
  return (
    <>
      <PageHeader title={t.invoices.new} />
      <InvoiceEditor
        t={t}
        locale={locale}
        currency={settings.currency_code}
        invoiceId={null}
        initialCustomer=""
        initialNotes=""
        initialLines={[]}
      />
    </>
  );
}
