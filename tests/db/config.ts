export const TEST_DB_NAME = "stockflow_test";

/**
 * Two ways to run the database tests:
 *  1. Default: a throwaway database is created on a local PostgreSQL server
 *     (TEST_DATABASE_ADMIN_URL), with a small Supabase shim (supabase-shim.sql).
 *  2. TEST_DATABASE_URL: use an existing local Supabase database as-is
 *     (e.g. the supabase/postgres Docker image or `supabase start`).
 * Never point either variable at your production project.
 */
export const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";

export const existingDbUrl = process.env.TEST_DATABASE_URL;

export function testDbUrl(): string {
  if (existingDbUrl) return existingDbUrl;
  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}
