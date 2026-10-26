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
