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
