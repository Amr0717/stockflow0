-- TEST ENVIRONMENT ONLY (bare supabase/postgres Docker image without the Auth service).
-- On a real Supabase project these definitions are installed by Supabase Auth's own
-- migrations; this file reproduces them so PostgREST (which sets request.jwt.claims)
-- and auth.uid() agree. Never run this on a hosted project.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
