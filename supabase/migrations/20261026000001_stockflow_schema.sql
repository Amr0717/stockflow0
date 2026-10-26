-- =============================================================================
-- StockFlow — initial schema
-- Tables, constraints, indexes, immutability triggers, Row Level Security and
-- least-privilege grants. Business operations live in the next migration.
--
-- Security model (short version):
--   * The browser only ever talks to Postgres as the `authenticated` role.
--   * `authenticated` may SELECT its own rows (RLS: owner_id = auth.uid()).
--   * `authenticated` has NO direct INSERT/UPDATE/DELETE on any table.
--     Every write goes through a guarded SECURITY DEFINER function
--     (see 20261026000002_stockflow_operations.sql).
--   * `anon` (signed-out visitors) has no access at all.
-- =============================================================================

-- Private schema for internal helpers. Not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.invoice_status as enum ('draft', 'issued', 'cancelled');

create type public.movement_type as enum (
  'initial',       -- opening stock when a product is created
  'restock',       -- goods received (+)
  'adjustment',    -- manual correction (+/-), e.g. stock count, damage
  'sale',          -- invoice issued (-)
  'cancellation'   -- issued invoice cancelled (+)
);

-- ---------------------------------------------------------------------------
-- Helper: keep updated_at fresh
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- owner_settings: one row per owner
-- ---------------------------------------------------------------------------
create table public.owner_settings (
  owner_id                    uuid primary key references auth.users (id) on delete cascade,
  business_name               text not null default '' check (char_length(business_name) <= 200),
  business_address            text not null default '' check (char_length(business_address) <= 500),
  business_phone              text not null default '' check (char_length(business_phone) <= 50),
  business_tax_id             text not null default '' check (char_length(business_tax_id) <= 50),
  invoice_footer              text not null default '' check (char_length(invoice_footer) <= 500),
  currency_code               text not null default 'ILS' check (currency_code in ('ILS', 'USD', 'EUR')),
  default_low_stock_threshold integer not null default 5 check (default_low_stock_threshold between 0 and 1000000),
  locale                      text not null default 'ar' check (locale in ('ar', 'en')),
  timezone                    text not null default 'Asia/Hebron' check (char_length(timezone) between 1 and 64),
  invoice_prefix              text not null default 'INV-' check (invoice_prefix ~ '^[A-Za-z0-9-]{0,12}$'),
  -- Next sequential invoice number. Only changed inside issue_invoice() while
  -- the row is locked, so two concurrent issues can never get the same number.
  next_invoice_number         bigint not null default 1 check (next_invoice_number > 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger owner_settings_updated_at
  before update on public.owner_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users (id) on delete cascade,
  -- SKU is TEXT so "000123" stays "000123". Trimmed, 1..64 chars.
  sku                 text not null check (sku = btrim(sku) and char_length(sku) between 1 and 64),
  name                text not null check (name = btrim(name) and char_length(name) between 1 and 200),
  description         text check (description is null or char_length(description) <= 2000),
  quantity_on_hand    integer not null default 0 check (quantity_on_hand >= 0),
  -- Money is stored as integer minor units (agorot / cents). 19.95 => 1995.
  unit_price_minor    bigint not null default 0 check (unit_price_minor >= 0),
  cost_minor          bigint check (cost_minor is null or cost_minor >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold between 0 and 1000000),
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Lets child tables reference (id, owner_id) so ownership is enforced by FK.
  unique (id, owner_id)
);

-- One SKU per owner (case-insensitive: "ab-1" and "AB-1" are the same model).
create unique index products_owner_sku_key on public.products (owner_id, lower(sku));
create index products_owner_name_idx on public.products (owner_id, name);
create index products_owner_active_idx on public.products (owner_id) where archived_at is null;

create trigger products_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  -- Assigned only when the invoice is issued (drafts have no number).
  invoice_number text,
  status         public.invoice_status not null default 'draft',
  customer_name  text check (customer_name is null or char_length(customer_name) <= 200),
  notes          text check (notes is null or char_length(notes) <= 2000),
  currency_code  text not null default 'ILS' check (currency_code in ('ILS', 'USD', 'EUR')),
  total_minor    bigint not null default 0 check (total_minor >= 0),
  issued_at      timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, invoice_number),
  -- The columns must always agree with the status.
  constraint invoices_status_fields check (
    (status = 'draft'     and invoice_number is null     and issued_at is null     and cancelled_at is null)
 or (status = 'issued'    and invoice_number is not null and issued_at is not null and cancelled_at is null)
 or (status = 'cancelled' and invoice_number is not null and issued_at is not null and cancelled_at is not null)
  )
);

create index invoices_owner_status_idx on public.invoices (owner_id, status);
create index invoices_owner_issued_at_idx on public.invoices (owner_id, issued_at desc);
create index invoices_owner_created_at_idx on public.invoices (owner_id, created_at desc);

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- invoice_items
-- While the invoice is a draft, sku/product_name are informational.
-- At issue time they are refreshed from the product and then frozen forever.
-- ---------------------------------------------------------------------------
create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null,
  owner_id         uuid not null,
  product_id       uuid not null,
  line_no          integer not null check (line_no > 0),
  sku              text not null,
  product_name     text not null,
  quantity         integer not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null,
  created_at       timestamptz not null default now(),
  constraint invoice_items_line_total check (line_total_minor = quantity::bigint * unit_price_minor),
  unique (invoice_id, line_no),
  -- Same owner as the invoice and as the product: enforced by the database.
  foreign key (invoice_id, owner_id) references public.invoices (id, owner_id) on delete cascade,
  foreign key (product_id, owner_id) references public.products (id, owner_id) on delete restrict
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index invoice_items_product_idx on public.invoice_items (product_id);

-- ---------------------------------------------------------------------------
-- stock_movements: append-only audit log of every quantity change
-- ---------------------------------------------------------------------------
create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  product_id      uuid not null,
  invoice_id      uuid,
  movement_type   public.movement_type not null,
  delta           integer not null check (delta <> 0),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after  integer not null check (quantity_after >= 0),
  reason          text not null check (char_length(btrim(reason)) between 1 and 500),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  constraint stock_movements_math check (quantity_after = quantity_before + delta),
  constraint stock_movements_direction check (
    (movement_type in ('initial', 'restock', 'cancellation') and delta > 0)
 or (movement_type = 'sale' and delta < 0)
 or (movement_type = 'adjustment')
  ),
  constraint stock_movements_invoice_link check (
    (movement_type in ('sale', 'cancellation')) = (invoice_id is not null)
  ),
  foreign key (product_id, owner_id) references public.products (id, owner_id) on delete restrict,
  foreign key (invoice_id, owner_id) references public.invoices (id, owner_id) on delete restrict
);

-- Exactly-once guard at the storage level: an invoice can produce at most one
-- sale movement and one cancellation movement per product.
create unique index stock_movements_once_per_invoice
  on public.stock_movements (invoice_id, product_id, movement_type)
  where invoice_id is not null;

create index stock_movements_owner_created_idx on public.stock_movements (owner_id, created_at desc);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index stock_movements_invoice_idx on public.stock_movements (invoice_id) where invoice_id is not null;

-- ---------------------------------------------------------------------------
-- Immutability triggers (defence in depth, they also apply to the functions)
-- ---------------------------------------------------------------------------

-- Stock movements are append-only.
create function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable_record' using errcode = 'P0001',
    detail = format('%s rows cannot be updated or deleted', tg_table_name);
end;
$$;

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function private.forbid_change();

-- Invoices: only draft -> issued -> cancelled; issued data is frozen;
-- only drafts may be deleted.
create function private.guard_invoice_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'invoice_not_draft' using errcode = 'P0001',
        detail = 'Only draft invoices can be deleted';
    end if;
    return old;
  end if;

  if old.owner_id <> new.owner_id then
    raise exception 'immutable_record' using errcode = 'P0001', detail = 'owner_id cannot change';
  end if;

  if old.status = 'draft' then
    if new.status = 'cancelled' then
      raise exception 'invalid_status_transition' using errcode = 'P0001', detail = 'draft -> cancelled';
    end if;
    return new;
  end if;

  if old.status = 'issued' and new.status in ('issued', 'cancelled') then
    if (new.invoice_number, new.customer_name, new.notes, new.currency_code, new.total_minor, new.issued_at)
       is distinct from
       (old.invoice_number, old.customer_name, old.notes, old.currency_code, old.total_minor, old.issued_at) then
      raise exception 'immutable_record' using errcode = 'P0001', detail = 'Issued invoice content is frozen';
    end if;
    return new;
  end if;

  if old.status = 'cancelled' and new is not distinct from old then
    return new;
  end if;

  raise exception 'invalid_status_transition' using errcode = 'P0001',
    detail = format('%s -> %s', old.status, new.status);
end;
$$;

create trigger invoices_guard
  before update or delete on public.invoices
  for each row execute function private.guard_invoice_change();

-- Invoice lines can only change while their invoice is a draft.
create function private.guard_invoice_item_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status
  from public.invoices
  where id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;

  -- Parent already gone: this is the cascade from deleting a draft
  -- (guard_invoice_change only allows deleting drafts).
  if not found and tg_op = 'DELETE' then
    return old;
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'immutable_record' using errcode = 'P0001',
      detail = 'Lines of an issued or cancelled invoice cannot change';
  end if;

  if tg_op = 'UPDATE' and (new.invoice_id <> old.invoice_id or new.owner_id <> old.owner_id) then
    raise exception 'immutable_record' using errcode = 'P0001', detail = 'Line cannot move between invoices';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger invoice_items_guard
  before insert or update or delete on public.invoice_items
  for each row execute function private.guard_invoice_item_change();

-- ---------------------------------------------------------------------------
-- Row Level Security: every table is owner-scoped. Read-only for clients.
-- ---------------------------------------------------------------------------
alter table public.owner_settings  enable row level security;
alter table public.products        enable row level security;
alter table public.invoices        enable row level security;
alter table public.invoice_items   enable row level security;
alter table public.stock_movements enable row level security;

create policy "owner reads own settings" on public.owner_settings
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "owner reads own products" on public.products
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "owner reads own invoices" on public.invoices
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "owner reads own invoice items" on public.invoice_items
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "owner reads own stock movements" on public.stock_movements
  for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants broad default privileges on new tables to `anon`
-- and `authenticated`; a policy alone does not remove them, so revoke first.
-- ---------------------------------------------------------------------------
revoke all on table
  public.owner_settings, public.products, public.invoices,
  public.invoice_items, public.stock_movements
from public, anon, authenticated;

grant select on table
  public.owner_settings, public.products, public.invoices,
  public.invoice_items, public.stock_movements
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
