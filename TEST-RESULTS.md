# Test results

Run on 2026-10-26 in a Linux container (Node 22.22, PostgreSQL 16.15 local, Docker image `supabase/postgres:17.11.0.006`).
Everything below was actually executed; the last section lists what was **not** verified.

## 1. Static checks and build

| Command | Result |
| --- | --- |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | ✅ no errors |
| `npm run lint` (ESLint, `eslint-config-next` 16.4.3) | ✅ no errors, no warnings |
| `npm run build` (Next.js 16.4.3, Turbopack) | ✅ compiled; 11 dynamic routes + proxy |

## 2. Unit tests — money and numbers

`npm run test` → ✅ **32 / 32 passed** (`tests/unit/numbers.test.ts` 31, `tests/unit/setup-sql.test.ts` 1: `supabase/setup.sql` matches the migrations)

Covers decimal parsing without floats (`19.95 → 1995`, Arabic-Indic digits `١٩٫٩٥`), rejects `-1`, `1.234`, `1e3`, quantities `0 / -1 / 1.5`, exact totals (`3×19.95 + 7×0.10 + 3×0.33 = 61.54`), `0.1 + 0.2 = 0.30`.

## 3. Database tests — real PostgreSQL, real migrations

All calls run as role `anon` / `authenticated` with JWT claims, exactly like the Supabase Data API, and the assertions read the database afterwards.

| Command | Database | Result |
| --- | --- | --- |
| `npm run test:db` | PostgreSQL 16 + `tests/db/supabase-shim.sql` (fresh DB) | ✅ **50 / 50 passed** |
| `TEST_DATABASE_URL=… npm run test:db` | official `supabase/postgres:17` image (real Supabase roles, non-superuser `postgres`, Supabase default grants) | ✅ **50 / 50 passed** |
| `psql -v ON_ERROR_STOP=1 -f <each migration>` on a **fresh** `supabase/postgres:17` container | — | ✅ both migrations applied without errors |

### Acceptance checklist (skill + spec)

| Scenario | Covered by | Result |
| --- | --- | --- |
| SKU `000123` stays `000123`, searchable | db + browser | ✅ |
| Duplicate SKU rejected (also case-insensitive) | db + browser | ✅ |
| A = 50, issue 5 → 45, persists (new connection / reload), one sale movement | db + browser | ✅ |
| Draft changes nothing | db + browser | ✅ |
| A=10, B=2, issue A:3 + B:5 → whole issue fails, no partial movement, still draft | db | ✅ |
| Quantity `0`, `-1`, `1.5`, `"2"`, `null`, > available rejected | db (+ UI disables issue) | ✅ |
| Same invoice issued twice (sequential) → subtracts once, `already_processed` | db | ✅ |
| Same invoice issued 8× **concurrently** → subtracts once | db | ✅ |
| Stock 5, two concurrent invoices of 4 (held transaction) → one issues, other `insufficient_stock`, stock 1 | db | ✅ |
| 20 concurrent 1-unit invoices vs stock 10 → exactly 10 succeed, stock 0, never negative | db | ✅ |
| Overlapping multi-product invoices in opposite line order → no deadlock | db | ✅ |
| Same SKU on two lines (2 + 3) with stock 4 → rejected on aggregate 5 | db | ✅ |
| Cancel restores exactly once; repeated / 6× concurrent cancel restores once | db + browser | ✅ |
| Draft cannot be cancelled; cancelled invoice cannot be re-issued | db | ✅ |
| Issued lines/content immutable (even for the DB owner, via triggers); movements append-only | db | ✅ |
| Total changed after review → `total_mismatch`, nothing changes | db | ✅ |
| Invoice numbers sequential and unique under concurrency | db | ✅ |
| Price snapshot: issued at 19.95, product changed to 22.00 → invoice stays 19.95 | db + browser | ✅ |
| Money: multi-line agorot totals exact (6154, 9985) | db + unit + browser | ✅ |
| Archived product: history readable, hard delete blocked by FK, cannot be sold | db | ✅ |
| `anon`: no read of any table, no RPC | db | ✅ |
| Unrelated user: sees 0 rows, every RPC on owner's ids fails, stock unchanged | db + browser | ✅ |
| Owner cannot write tables directly (UPDATE stock, set status, insert movement, delete invoice) | db | ✅ |
| Catalog: RLS on every table; anon has no grants; authenticated SELECT only; every function `search_path=""` and not executable by anon/public | db | ✅ |
| Restock/adjustment audited with reason, cannot go negative | db + browser | ✅ |

## 4. Browser smoke test (Playwright + Chromium)

`npm run test:e2e` (= `node tests/e2e/smoke.mjs`) against `next start` (production build) → ✅ **19 / 19 steps passed** (run twice in a row, both green).

Stack used: the real app → **real PostgREST v16.5** → **real `supabase/postgres:17`** database with the migrations. RLS, grants and the SQL functions were exercised for real.
Steps: login redirect + Arabic RTL, wrong password, dashboard, create products, duplicate SKU, search, issue (50 → 45, total 99.85, one sale movement), reload + A4 PDF (1 page), draft = no change, over-stock blocked, price snapshot, restock with reason, cancel (45 → 50, one cancellation movement), stock history, English LTR, mobile drawer + no horizontal scroll at 390 px, sign-out, unrelated user isolation.

Screenshots and the generated PDFs are in `docs/screenshots/`.

## 4b. Second run with the real Supabase Auth server (GoTrue)

Later on 2026-10-26 the official `supabase/gotrue:v2.197.0` image became available, so the stack was re-run with **no auth stand-in**:
fresh `supabase/postgres:17` → GoTrue (its own migrations, sign-up disabled) → `supabase/setup.sql` applied with `psql -v ON_ERROR_STOP=1` (no errors) → PostgREST v16.5 → `next start`. The gateway (`tests/e2e/local-gateway.mjs` with `AUTH_URL`) only routed `/auth/v1` and `/rest/v1` unchanged.

| Check | Result |
| --- | --- |
| GoTrue `POST /signup` | ✅ rejected `signup_disabled` |
| `npm run doctor` against this stack | ✅ all checks green; it also flags a `sb_secret_` key as dangerous |
| `npm run test:db` on this database | ✅ 50 / 50 |
| `npm run test:e2e` with `E2E_SKU_A=A102` (real sign-in via GoTrue) | ✅ 19 / 19 — A102: 50 → sell 5 → 45 → reload still 45 → cancel → 50; audit rows initial +50, sale −5 (50→45), cancellation +5 (45→50) |
| `npm run test:e2e` again with the new step "double-click the issue button" | ✅ 20 / 20 — stock 50 → 48, exactly one new sale movement |
| Deleting a stock movement as the DB owner | ✅ blocked by trigger (`stock_movements rows cannot be updated or deleted`) |

## 5. NOT verified (be aware)

- **No real hosted Supabase project was connected** — no credentials were provided. The app has not been deployed to Vercel.
- Supabase Auth was verified with the official GoTrue server locally (section 4b), not with a hosted Supabase project.
- Printing was verified with Chromium's print engine (`page.pdf`, A4); the print dialog on your own browser/printer was not tested. Safari/iOS and Firefox were not tested.
