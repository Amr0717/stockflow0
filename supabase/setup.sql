-- =============================================================================
-- StockFlow — ONE-FILE DATABASE SETUP (generated from supabase/migrations/*.sql)
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Run it ONCE on a new, empty project. Do not edit; regenerate with:
--   npm.cmd run build:setup-sql
-- =============================================================================

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


-- =============================================================================
-- StockFlow — guarded operations
--
-- Every write in the app goes through one of these functions. Each one:
--   * runs as a single transaction (a Postgres function call is atomic:
--     any RAISE rolls back everything it did),
--   * checks the caller is signed in (auth.uid()) and only touches rows
--     owned by that caller,
--   * is SECURITY DEFINER with an empty search_path and fully qualified names,
--   * can be executed by `authenticated` only (never `anon`).
--
-- Errors are raised with a short machine-readable MESSAGE (e.g.
-- 'insufficient_stock') that the app translates into Arabic/English.
--
-- Lock order (prevents deadlocks): invoice row -> product rows ordered by id
-- -> owner_settings row.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create function private.require_owner()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- Returns the settings row, creating it with defaults on first use.
create function private.ensure_settings(p_owner uuid)
returns public.owner_settings
language plpgsql
set search_path = ''
as $$
declare
  v_row public.owner_settings;
begin
  insert into public.owner_settings (owner_id) values (p_owner)
  on conflict (owner_id) do nothing;
  select * into v_row from public.owner_settings where owner_id = p_owner;
  return v_row;
end;
$$;

-- Normalises optional text: trims and turns '' into NULL.
create function private.clean_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p_value), '');
$$;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create function public.create_product(
  p_sku                 text,
  p_name                text,
  p_description         text,
  p_unit_price_minor    bigint,
  p_cost_minor          bigint,
  p_low_stock_threshold integer,
  p_initial_quantity    integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
  v_id    uuid;
  v_qty   integer := coalesce(p_initial_quantity, 0);
begin
  if v_qty < 0 then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;

  begin
    insert into public.products (
      owner_id, sku, name, description, quantity_on_hand,
      unit_price_minor, cost_minor, low_stock_threshold
    ) values (
      v_owner, btrim(p_sku), btrim(p_name), private.clean_text(p_description), v_qty,
      coalesce(p_unit_price_minor, 0), p_cost_minor,
      coalesce(p_low_stock_threshold, (private.ensure_settings(v_owner)).default_low_stock_threshold)
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate_sku' using errcode = 'P0001', detail = btrim(p_sku);
  end;

  if v_qty > 0 then
    insert into public.stock_movements (
      owner_id, product_id, movement_type, delta,
      quantity_before, quantity_after, reason, created_by
    ) values (
      v_owner, v_id, 'initial', v_qty, 0, v_qty, 'Initial stock', v_owner
    );
  end if;

  return v_id;
end;
$$;

-- Edits product details. Quantity is deliberately NOT a parameter:
-- stock only changes through adjust_stock / issue_invoice / cancel_invoice.
create function public.update_product(
  p_product_id          uuid,
  p_sku                 text,
  p_name                text,
  p_description         text,
  p_unit_price_minor    bigint,
  p_cost_minor          bigint,
  p_low_stock_threshold integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  begin
    update public.products
    set sku                 = btrim(p_sku),
        name                = btrim(p_name),
        description         = private.clean_text(p_description),
        unit_price_minor    = coalesce(p_unit_price_minor, 0),
        cost_minor          = p_cost_minor,
        low_stock_threshold = coalesce(p_low_stock_threshold, low_stock_threshold)
    where id = p_product_id and owner_id = v_owner;
  exception when unique_violation then
    raise exception 'duplicate_sku' using errcode = 'P0001', detail = btrim(p_sku);
  end;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Archive / restore. Products are never hard-deleted (history refers to them).
create function public.set_product_archived(p_product_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  update public.products
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
  where id = p_product_id and owner_id = v_owner;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Restock (+) or adjust (+/-) with a mandatory reason. Always audited.
create function public.adjust_stock(
  p_product_id    uuid,
  p_movement_type public.movement_type,
  p_delta         integer,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid := private.require_owner();
  v_before integer;
  v_after  integer;
begin
  if p_movement_type not in ('restock', 'adjustment') then
    raise exception 'invalid_movement_type' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 or (p_movement_type = 'restock' and p_delta < 0) then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;
  if private.clean_text(p_reason) is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select quantity_on_hand into v_before
  from public.products
  where id = p_product_id and owner_id = v_owner
  for update;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;

  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'insufficient_stock' using errcode = 'P0001',
      detail = jsonb_build_object('available', v_before, 'requested', -p_delta)::text;
  end if;

  update public.products set quantity_on_hand = v_after where id = p_product_id;

  insert into public.stock_movements (
    owner_id, product_id, movement_type, delta,
    quantity_before, quantity_after, reason, created_by
  ) values (
    v_owner, p_product_id, p_movement_type, p_delta,
    v_before, v_after, btrim(p_reason), v_owner
  );

  return jsonb_build_object('quantity_before', v_before, 'quantity_after', v_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- Draft invoices (no stock effect)
-- p_items: [{"product_id": "...", "quantity": 2, "unit_price_minor": 1995}, ...]
-- Creates a new draft when p_invoice_id is null, otherwise replaces the lines
-- of an existing draft. Returns the invoice id.
-- ---------------------------------------------------------------------------
create function public.save_draft_invoice(
  p_invoice_id    uuid,
  p_customer_name text,
  p_notes         text,
  p_items         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid := private.require_owner();
  v_id       uuid := p_invoice_id;
  v_status   public.invoice_status;
  v_item     jsonb;
  v_line     integer := 0;
  v_qty      integer;
  v_price    bigint;
  v_product  public.products;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'invoice_empty' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too_many_items' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.invoices (owner_id, customer_name, notes, currency_code)
    values (
      v_owner, private.clean_text(p_customer_name), private.clean_text(p_notes),
      (private.ensure_settings(v_owner)).currency_code
    )
    returning id into v_id;
  else
    select status into v_status
    from public.invoices
    where id = v_id and owner_id = v_owner
    for update;

    if not found then
      raise exception 'invoice_not_found' using errcode = 'P0001';
    end if;
    if v_status <> 'draft' then
      raise exception 'invoice_not_draft' using errcode = 'P0001';
    end if;

    update public.invoices
    set customer_name = private.clean_text(p_customer_name),
        notes         = private.clean_text(p_notes)
    where id = v_id;

    delete from public.invoice_items where invoice_id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;

    -- Whole positive numbers only: rejects 0, -1, 1.5, "abc", null.
    if jsonb_typeof(v_item -> 'quantity') <> 'number'
       or (v_item ->> 'quantity') !~ '^[0-9]{1,9}$'
       or (v_item ->> 'quantity')::integer <= 0 then
      raise exception 'invalid_quantity' using errcode = 'P0001',
        detail = jsonb_build_object('line', v_line)::text;
    end if;
    if jsonb_typeof(v_item -> 'unit_price_minor') <> 'number'
       or (v_item ->> 'unit_price_minor') !~ '^[0-9]{1,15}$' then
      raise exception 'invalid_price' using errcode = 'P0001',
        detail = jsonb_build_object('line', v_line)::text;
    end if;
    v_qty   := (v_item ->> 'quantity')::integer;
    v_price := (v_item ->> 'unit_price_minor')::bigint;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid and owner_id = v_owner;

    if not found then
      raise exception 'product_not_found' using errcode = 'P0001',
        detail = jsonb_build_object('line', v_line)::text;
    end if;
    if v_product.archived_at is not null then
      raise exception 'product_archived' using errcode = 'P0001',
        detail = jsonb_build_object('sku', v_product.sku)::text;
    end if;

    insert into public.invoice_items (
      invoice_id, owner_id, product_id, line_no, sku, product_name,
      quantity, unit_price_minor, line_total_minor
    ) values (
      v_id, v_owner, v_product.id, v_line, v_product.sku, v_product.name,
      v_qty, v_price, v_qty::bigint * v_price
    );
  end loop;

  update public.invoices
  set total_minor = (select coalesce(sum(line_total_minor), 0)
                     from public.invoice_items where invoice_id = v_id)
  where id = v_id;

  return v_id;
end;
$$;

create function public.delete_draft_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid := private.require_owner();
  v_status public.invoice_status;
begin
  select status into v_status
  from public.invoices
  where id = p_invoice_id and owner_id = v_owner
  for update;

  if not found then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'draft' then
    raise exception 'invoice_not_draft' using errcode = 'P0001';
  end if;

  delete from public.invoices where id = p_invoice_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- ISSUE: the only place a sale reduces stock.
--
-- p_expected_total_minor is the total the owner reviewed on screen. If the
-- draft changed meanwhile (e.g. edited in another tab), the issue is refused
-- instead of silently charging a different amount.
--
-- Idempotent: issuing an already-issued invoice changes nothing and returns
-- already_processed = true.
-- ---------------------------------------------------------------------------
create function public.issue_invoice(
  p_invoice_id           uuid,
  p_expected_total_minor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid := private.require_owner();
  v_invoice  public.invoices;
  v_settings public.owner_settings;
  v_row      record;
  v_total    bigint;
  v_number   text;
  v_before   integer;
begin
  -- 1. Lock the invoice. A second concurrent call waits here, then sees
  --    status = 'issued' and returns without touching stock.
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and owner_id = v_owner
  for update;

  if not found then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status = 'issued' then
    return jsonb_build_object(
      'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'status', v_invoice.status, 'already_processed', true);
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'invoice_cancelled' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.invoice_items where invoice_id = v_invoice.id) then
    raise exception 'invoice_empty' using errcode = 'P0001';
  end if;

  -- 2. Lock every product on the invoice, always in the same order (by id),
  --    so two invoices sharing products can never deadlock.
  perform 1
  from public.products p
  where p.owner_id = v_owner
    and p.id in (select i.product_id from public.invoice_items i where i.invoice_id = v_invoice.id)
  order by p.id
  for update;

  -- 3. Validate against the locked rows. Quantities are aggregated per
  --    product, so the same SKU on two lines is checked as one total.
  for v_row in
    select p.id, p.sku, p.quantity_on_hand, p.archived_at, sum(i.quantity)::bigint as qty
    from public.invoice_items i
    join public.products p on p.id = i.product_id and p.owner_id = v_owner
    where i.invoice_id = v_invoice.id
    group by p.id
    order by p.id
  loop
    if v_row.archived_at is not null then
      raise exception 'product_archived' using errcode = 'P0001',
        detail = jsonb_build_object('sku', v_row.sku)::text;
    end if;
    if v_row.qty > v_row.quantity_on_hand then
      raise exception 'insufficient_stock' using errcode = 'P0001',
        detail = jsonb_build_object(
          'sku', v_row.sku, 'available', v_row.quantity_on_hand, 'requested', v_row.qty)::text;
    end if;
  end loop;

  -- 4. Freeze line snapshots (current SKU and name) and recompute amounts
  --    on the server. Prices are the ones stored on the draft lines.
  update public.invoice_items i
  set sku = p.sku,
      product_name = p.name,
      line_total_minor = i.quantity::bigint * i.unit_price_minor
  from public.products p
  where i.invoice_id = v_invoice.id and p.id = i.product_id;

  select coalesce(sum(line_total_minor), 0) into v_total
  from public.invoice_items where invoice_id = v_invoice.id;

  if p_expected_total_minor is null or v_total <> p_expected_total_minor then
    raise exception 'total_mismatch' using errcode = 'P0001',
      detail = jsonb_build_object('expected', p_expected_total_minor, 'actual', v_total)::text;
  end if;

  -- 5. Subtract stock and write one audit movement per product.
  for v_row in
    select i.product_id, sum(i.quantity)::integer as qty
    from public.invoice_items i
    where i.invoice_id = v_invoice.id
    group by i.product_id
    order by i.product_id
  loop
    update public.products
    set quantity_on_hand = quantity_on_hand - v_row.qty
    where id = v_row.product_id and owner_id = v_owner
    returning quantity_on_hand + v_row.qty into v_before;

    insert into public.stock_movements (
      owner_id, product_id, invoice_id, movement_type, delta,
      quantity_before, quantity_after, reason, created_by
    ) values (
      v_owner, v_row.product_id, v_invoice.id, 'sale', -v_row.qty,
      v_before, v_before - v_row.qty, 'Invoice issued', v_owner
    );
  end loop;

  -- 6. Take the next invoice number (row lock = no duplicates, no races).
  perform private.ensure_settings(v_owner);
  update public.owner_settings
  set next_invoice_number = next_invoice_number + 1
  where owner_id = v_owner
  returning * into v_settings;

  v_number := v_settings.invoice_prefix || lpad((v_settings.next_invoice_number - 1)::text, 6, '0');

  -- 7. The single state transition draft -> issued.
  update public.invoices
  set status = 'issued',
      invoice_number = v_number,
      issued_at = now(),
      total_minor = v_total
  where id = v_invoice.id and status = 'draft';

  return jsonb_build_object(
    'invoice_id', v_invoice.id, 'invoice_number', v_number,
    'status', 'issued', 'already_processed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- CANCEL: restores the exact issued quantities exactly once.
-- Idempotent: cancelling an already-cancelled invoice changes nothing.
-- ---------------------------------------------------------------------------
create function public.cancel_invoice(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid := private.require_owner();
  v_invoice public.invoices;
  v_row     record;
  v_before  integer;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and owner_id = v_owner
  for update;

  if not found then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status = 'cancelled' then
    return jsonb_build_object(
      'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'status', v_invoice.status, 'already_processed', true);
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'invoice_not_issued' using errcode = 'P0001';
  end if;

  perform 1
  from public.products p
  where p.owner_id = v_owner
    and p.id in (select i.product_id from public.invoice_items i where i.invoice_id = v_invoice.id)
  order by p.id
  for update;

  -- Restore from the frozen line snapshots.
  for v_row in
    select i.product_id, sum(i.quantity)::integer as qty
    from public.invoice_items i
    where i.invoice_id = v_invoice.id
    group by i.product_id
    order by i.product_id
  loop
    update public.products
    set quantity_on_hand = quantity_on_hand + v_row.qty
    where id = v_row.product_id and owner_id = v_owner
    returning quantity_on_hand - v_row.qty into v_before;

    insert into public.stock_movements (
      owner_id, product_id, invoice_id, movement_type, delta,
      quantity_before, quantity_after, reason, created_by
    ) values (
      v_owner, v_row.product_id, v_invoice.id, 'cancellation', v_row.qty,
      v_before, v_before + v_row.qty,
      coalesce(private.clean_text(p_reason), 'Invoice cancelled'), v_owner
    );
  end loop;

  update public.invoices
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = private.clean_text(p_reason)
  where id = v_invoice.id and status = 'issued';

  return jsonb_build_object(
    'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'status', 'cancelled', 'already_processed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create function public.update_owner_settings(
  p_business_name               text,
  p_business_address            text,
  p_business_phone              text,
  p_business_tax_id             text,
  p_invoice_footer              text,
  p_currency_code               text,
  p_default_low_stock_threshold integer,
  p_locale                      text,
  p_invoice_prefix              text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  perform private.ensure_settings(v_owner);

  update public.owner_settings
  set business_name               = coalesce(btrim(p_business_name), ''),
      business_address            = coalesce(btrim(p_business_address), ''),
      business_phone              = coalesce(btrim(p_business_phone), ''),
      business_tax_id             = coalesce(btrim(p_business_tax_id), ''),
      invoice_footer              = coalesce(btrim(p_invoice_footer), ''),
      currency_code               = coalesce(p_currency_code, currency_code),
      default_low_stock_threshold = coalesce(p_default_low_stock_threshold, default_low_stock_threshold),
      locale                      = coalesce(p_locale, locale),
      invoice_prefix              = coalesce(btrim(p_invoice_prefix), invoice_prefix)
  where owner_id = v_owner;
end;
$$;

-- Saves only the interface language (used by the language switch).
create function public.set_owner_locale(p_locale text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  perform private.ensure_settings(v_owner);
  update public.owner_settings set locale = p_locale where owner_id = v_owner;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read helpers (SECURITY INVOKER: RLS applies as usual)
-- ---------------------------------------------------------------------------
create function public.get_dashboard_stats()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'active_products', (select count(*) from public.products where archived_at is null),
    'total_units',     (select coalesce(sum(quantity_on_hand), 0) from public.products where archived_at is null),
    'issued_invoices', (select count(*) from public.invoices where status = 'issued'),
    'low_stock',       (select count(*) from public.products
                        where archived_at is null and quantity_on_hand <= low_stock_threshold)
  );
$$;

create function public.get_low_stock_products(p_limit integer default 10)
returns setof public.products
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.products
  where archived_at is null and quantity_on_hand <= low_stock_threshold
  order by quantity_on_hand asc, sku asc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE privileges: nobody by default, then authenticated only.
-- ---------------------------------------------------------------------------
revoke all on function
  public.create_product(text, text, text, bigint, bigint, integer, integer),
  public.update_product(uuid, text, text, text, bigint, bigint, integer),
  public.set_product_archived(uuid, boolean),
  public.adjust_stock(uuid, public.movement_type, integer, text),
  public.save_draft_invoice(uuid, text, text, jsonb),
  public.delete_draft_invoice(uuid),
  public.issue_invoice(uuid, bigint),
  public.cancel_invoice(uuid, text),
  public.update_owner_settings(text, text, text, text, text, text, integer, text, text),
  public.set_owner_locale(text),
  public.get_dashboard_stats(),
  public.get_low_stock_products(integer)
from public, anon, authenticated;

grant execute on function
  public.create_product(text, text, text, bigint, bigint, integer, integer),
  public.update_product(uuid, text, text, text, bigint, bigint, integer),
  public.set_product_archived(uuid, boolean),
  public.adjust_stock(uuid, public.movement_type, integer, text),
  public.save_draft_invoice(uuid, text, text, jsonb),
  public.delete_draft_invoice(uuid),
  public.issue_invoice(uuid, bigint),
  public.cancel_invoice(uuid, text),
  public.update_owner_settings(text, text, text, text, text, text, integer, text, text),
  public.set_owner_locale(text),
  public.get_dashboard_stats(),
  public.get_low_stock_products(integer)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;


-- =============================================================================
-- StockFlow — management PIN for editing and deleting products
--
-- Editing a product, archiving/restoring it and deleting it now require the
-- owner's management PIN. The check happens inside the guarded functions, so
-- it cannot be skipped from the browser.
--
--   * The PIN is stored only as a bcrypt hash in the private schema, which the
--     Data API does not expose: the signed-in browser can never read it.
--   * Until a PIN is set (Settings page), protected operations are refused
--     with 'pin_not_set'.
--   * delete_product() hard-deletes a product only when nothing refers to it
--     (no invoice lines, no stock movements). Otherwise it archives it, so
--     invoices and the movement history stay intact.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Storage (private: no grants to anon/authenticated)
-- ---------------------------------------------------------------------------
create table private.owner_pins (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.owner_pins from public, anon, authenticated;

-- Raises 'pin_not_set' or 'invalid_pin' unless p_pin matches the owner's PIN.
create function private.require_manage_pin(p_owner uuid, p_pin text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash from private.owner_pins where owner_id = p_owner;
  if not found then
    raise exception 'pin_not_set' using errcode = 'P0001';
  end if;
  if p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    raise exception 'invalid_pin' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- PIN management
-- ---------------------------------------------------------------------------
create function public.has_manage_pin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.owner_pins where owner_id = private.require_owner());
$$;

-- Sets the PIN the first time, or changes it (the current PIN is required).
create function public.set_manage_pin(p_current_pin text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4,12}$' then
    raise exception 'invalid_pin_format' using errcode = 'P0001';
  end if;

  perform 1 from private.owner_pins where owner_id = v_owner for update;
  if found then
    perform private.require_manage_pin(v_owner, p_current_pin);
  end if;

  insert into private.owner_pins (owner_id, pin_hash)
  values (v_owner, extensions.crypt(p_new_pin, extensions.gen_salt('bf')))
  on conflict (owner_id) do update
    set pin_hash = excluded.pin_hash, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Products: same behaviour as before, plus the PIN check
-- ---------------------------------------------------------------------------
drop function public.update_product(uuid, text, text, text, bigint, bigint, integer);

create function public.update_product(
  p_product_id          uuid,
  p_sku                 text,
  p_name                text,
  p_description         text,
  p_unit_price_minor    bigint,
  p_cost_minor          bigint,
  p_low_stock_threshold integer,
  p_pin                 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  perform private.require_manage_pin(v_owner, p_pin);

  begin
    update public.products
    set sku                 = btrim(p_sku),
        name                = btrim(p_name),
        description         = private.clean_text(p_description),
        unit_price_minor    = coalesce(p_unit_price_minor, 0),
        cost_minor          = p_cost_minor,
        low_stock_threshold = coalesce(p_low_stock_threshold, low_stock_threshold)
    where id = p_product_id and owner_id = v_owner;
  exception when unique_violation then
    raise exception 'duplicate_sku' using errcode = 'P0001', detail = btrim(p_sku);
  end;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;
end;
$$;

drop function public.set_product_archived(uuid, boolean);

create function public.set_product_archived(p_product_id uuid, p_archived boolean, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  perform private.require_manage_pin(v_owner, p_pin);

  update public.products
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
  where id = p_product_id and owner_id = v_owner;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Returns 'deleted' (row removed) or 'archived' (row kept because invoices or
-- stock movements refer to it; it disappears from the inventory and from new
-- invoices, while old invoices and the history stay readable).
create function public.delete_product(p_product_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_owner();
begin
  perform private.require_manage_pin(v_owner, p_pin);

  -- The lock also waits for any draft that is adding this product right now.
  perform 1 from public.products
  where id = p_product_id and owner_id = v_owner
  for update;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.invoice_items where product_id = p_product_id)
     and not exists (select 1 from public.stock_movements where product_id = p_product_id) then
    begin
      delete from public.products where id = p_product_id and owner_id = v_owner;
      return 'deleted';
    exception when foreign_key_violation then
      -- Something started referring to it meanwhile: fall through to archive.
    end;
  end if;

  update public.products
  set archived_at = coalesce(archived_at, now())
  where id = p_product_id and owner_id = v_owner;
  return 'archived';
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE privileges
-- ---------------------------------------------------------------------------
revoke all on function
  public.has_manage_pin(),
  public.set_manage_pin(text, text),
  public.update_product(uuid, text, text, text, bigint, bigint, integer, text),
  public.set_product_archived(uuid, boolean, text),
  public.delete_product(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.has_manage_pin(),
  public.set_manage_pin(text, text),
  public.update_product(uuid, text, text, text, bigint, bigint, integer, text),
  public.set_product_archived(uuid, boolean, text),
  public.delete_product(uuid, text)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;


-- =============================================================================
-- StockFlow — add many products at once (paste from Excel / CSV)
--
-- create_products_bulk() creates every row through create_product(), so each
-- product gets exactly the same checks and its opening-stock movement. It is
-- all-or-nothing: if any row fails, nothing is saved and the error says which
-- row (detail: {"line": n, "sku": "..."}).
--
-- p_items: [{"sku": "A-1", "name": "...", "unit_price_minor": 1995,
--            "quantity": 10, "cost_minor": null}, ...]   (max 1000 rows)
-- =============================================================================

create function public.create_products_bulk(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner     uuid := private.require_owner();
  v_threshold integer;
  v_item      jsonb;
  v_line      integer := 0;
  v_sku       text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'too_many_rows' using errcode = 'P0001';
  end if;

  v_threshold := (private.ensure_settings(v_owner)).default_low_stock_threshold;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    v_sku  := v_item ->> 'sku';

    begin
      if private.clean_text(v_sku) is null or private.clean_text(v_item ->> 'name') is null
         or jsonb_typeof(v_item -> 'unit_price_minor') <> 'number'
         or (v_item ->> 'unit_price_minor') !~ '^[0-9]{1,15}$'
         or jsonb_typeof(v_item -> 'quantity') <> 'number'
         or (v_item ->> 'quantity') !~ '^[0-9]{1,9}$'
         or (v_item -> 'cost_minor' is not null and jsonb_typeof(v_item -> 'cost_minor') <> 'null'
             and (v_item ->> 'cost_minor') !~ '^[0-9]{1,15}$') then
        raise exception 'invalid_row' using errcode = 'P0001';
      end if;

      perform public.create_product(
        v_sku,
        v_item ->> 'name',
        null,
        (v_item ->> 'unit_price_minor')::bigint,
        (v_item ->> 'cost_minor')::bigint,
        v_threshold,
        (v_item ->> 'quantity')::integer
      );
    exception when others then
      -- Re-raise with the row number. Known codes (duplicate_sku, ...) keep
      -- their message; constraint errors (too long name, ...) become invalid_row.
      raise exception '%', case when sqlstate = 'P0001' then sqlerrm else 'invalid_row' end
        using errcode = 'P0001',
              detail = jsonb_build_object('line', v_line, 'sku', coalesce(v_sku, ''))::text;
    end;
  end loop;

  return v_line;
end;
$$;

revoke all on function public.create_products_bulk(jsonb) from public, anon, authenticated;
grant execute on function public.create_products_bulk(jsonb) to authenticated;
