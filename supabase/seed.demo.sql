-- =============================================================================
-- OPTIONAL demo data. OFF by default (supabase/config.toml: [db.seed] enabled = false).
-- Use only on a local/test project, never on your real inventory.
--
-- How to use: create the owner account first, replace the email below, then run
-- this file in the Supabase SQL editor. It uses the same guarded functions as
-- the app, so every opening quantity is recorded as a stock movement.
-- =============================================================================
do $$
declare
  v_owner uuid;
begin
  select id into v_owner from auth.users where email = 'owner@example.com';  -- <== change me
  if v_owner is null then
    raise notice 'Owner account not found: demo data skipped.';
    return;
  end if;

  -- Act as the owner for this transaction only.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  if exists (select 1 from public.products where owner_id = v_owner) then
    raise notice 'Owner already has products: demo data skipped.';
    return;
  end if;

  perform public.create_product('000123', 'قميص قطني أزرق', 'مقاس M', 1995, 1200, 5, 50);
  perform public.create_product('000124', 'قميص قطني أبيض', 'مقاس L', 1995, 1200, 5, 12);
  perform public.create_product('JK-200', 'جاكيت شتوي', null, 18900, 11000, 3, 4);
  perform public.create_product('CAP-01', 'قبعة رياضية', null, 3500, 1500, 10, 25);
  perform public.create_product('SOCK-3P', 'جوارب (3 أزواج)', null, 2450, null, 10, 6);
end;
$$;
