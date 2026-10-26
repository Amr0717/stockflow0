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
