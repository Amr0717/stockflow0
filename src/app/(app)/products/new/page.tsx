import type { Metadata } from "next";
import { ListPlus } from "lucide-react";
import { ProductForm } from "@/components/products/product-form";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSettings, requireUser } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/numbers";
import { createProductAction } from "../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  await requireUser();
  const [{ t }, settings] = await Promise.all([getI18n(), getSettings()]);
  return (
    <>
      <PageHeader
        title={t.products.newTitle}
        actions={
          <ButtonLink href="/products/import" variant="secondary">
            <ListPlus aria-hidden className="size-4" />
            {t.products.bulkAdd}
          </ButtonLink>
        }
      />
      <Card className="max-w-3xl p-5 sm:p-6">
        <ProductForm
          action={createProductAction}
          mode="create"
          t={t}
          currencySymbol={CURRENCY_SYMBOLS[settings.currency_code as CurrencyCode] ?? settings.currency_code}
          initial={{
            sku: "",
            name: "",
            description: "",
            price: "",
            cost: "",
            threshold: String(settings.default_low_stock_threshold),
            initial_quantity: "0",
          }}
        />
      </Card>
    </>
  );
}
