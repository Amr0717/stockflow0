// Prepares the test database and applies the real migrations.
// Requires a local PostgreSQL server (never point this at production).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { TEST_DB_NAME, adminUrl, existingDbUrl, testDbUrl } from "./config";

export default async function setup() {
  if (!existingDbUrl) {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${TEST_DB_NAME} with (force)`);
    await admin.query(`create database ${TEST_DB_NAME}`);
    await admin.end();
  }

  const db = new Client({ connectionString: testDbUrl() });
  await db.connect();
  const root = path.resolve(import.meta.dirname, "../..");

  // A real Supabase database already has auth.users / auth.uid(); plain Postgres needs the shim.
  const { rows } = await db.query("select to_regclass('auth.users') is not null as has_auth, to_regclass('public.products') is not null as migrated");
  if (!rows[0].has_auth) {
    await db.query(readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
  }
  if (!rows[0].migrated) {
    const migrationsDir = path.join(root, "supabase/migrations");
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  }
  await db.end();
}
