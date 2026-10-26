// Combines supabase/migrations/*.sql (in order) into supabase/setup.sql,
// so a beginner can set up the database by pasting ONE file in the SQL Editor.
// Usage: npm.cmd run build:setup-sql   (Windows)  |  npm run build:setup-sql
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const header = `-- =============================================================================
-- StockFlow — ONE-FILE DATABASE SETUP (generated from supabase/migrations/*.sql)
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Run it ONCE on a new, empty project. Do not edit; regenerate with:
--   npm.cmd run build:setup-sql
-- =============================================================================

`;
const body = files.map((f) => readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n").trimEnd()).join("\n\n\n");
writeFileSync(path.join(root, "supabase", "setup.sql"), `${header}${body}\n`);
console.log(`supabase/setup.sql written from: ${files.join(", ")}`);
