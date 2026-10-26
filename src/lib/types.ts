// Row shapes returned by Supabase (snake_case, as stored in Postgres).
export type InvoiceStatus = "draft" | "issued" | "cancelled";
export type MovementType = "initial" | "restock" | "adjustment" | "sale" | "cancellation";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  quantity_on_hand: number;
  unit_price_minor: number;
  cost_minor: number | null;
  low_stock_threshold: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  customer_name: string | null;
  notes: string | null;
  currency_code: string;
  total_minor: number;
  issued_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  product_id: string;
  line_no: number;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
};

export type StockMovement = {
  id: string;
  product_id: string;
  invoice_id: string | null;
  movement_type: MovementType;
  delta: number;
  quantity_before: number;
  quantity_after: number;
  reason: string;
  created_at: string;
  products?: { sku: string; name: string } | null;
  invoices?: { invoice_number: string | null } | null;
};

export type OwnerSettings = {
  owner_id: string;
  business_name: string;
  business_address: string;
  business_phone: string;
  business_tax_id: string;
  invoice_footer: string;
  currency_code: string;
  default_low_stock_threshold: number;
  locale: string;
  timezone: string;
  invoice_prefix: string;
};

export type ActionResult = { ok: boolean; message?: string; id?: string };
