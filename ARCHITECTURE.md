# StockFlow architecture

> **ملخص بالعربية:** المتصفح لا يكتب في الجداول مباشرة أبدًا. كل عملية تغيّر المخزون (إضافة منتج، توريد، تسوية، إصدار فاتورة، إلغاء فاتورة) هي دالة واحدة داخل PostgreSQL تعمل كمعاملة واحدة (transaction): إما أن تنجح كل خطواتها معًا، أو تفشل كلها ولا يتغير شيء. لذلك لا يمكن أن يحدث خصم جزئي أو خصم مرتين أو مخزون سالب.

## 1. Overview

```
Browser (React)                Next.js server (Vercel)              Supabase
──────────────                 ───────────────────────              ────────
pages / forms   ── action ──▶  Server Actions & Server   ── JWT ──▶ PostgREST ──▶ PostgreSQL
                               Components (src/app)                              • RLS (owner_id = auth.uid())
                               @supabase/ssr cookie session                      • SELECT-only grants
                                                                                 • guarded SQL functions (RPC)
                               proxy.ts: refresh session,                        Supabase Auth (login)
                               redirect signed-out users
```

- **Next.js 16 App Router**, all pages are dynamic server components (private data, read per request). Cache Components is intentionally not enabled to keep the model simple.
- **Server Actions** (`src/app/(app)/*/actions.ts`) validate input for good messages, then call **one** database function. They never do multi-step writes.
- **Supabase client** (`src/lib/supabase/server.ts`) is created per request with the user's session cookie. Only the public URL and publishable key are used; there is no service-role key anywhere in the app.
- **`src/proxy.ts`** (Next 16's replacement for middleware) refreshes the auth cookie and redirects signed-out visitors to `/login`. It is a convenience: the real protection is in the database.
- **Data Access Layer** (`src/lib/data.ts`): `requireUser()` verifies the session with `auth.getClaims()` before any page or action touches data.

## 2. Database (supabase/migrations)

| Table | Purpose |
| --- | --- |
| `products` | One row per SKU. `sku` is `text` (keeps `000123`), unique per owner (case-insensitive). `quantity_on_hand integer CHECK >= 0`. Money in integer minor units (`unit_price_minor bigint`). `archived_at` instead of delete. |
| `invoices` | `status` enum `draft → issued → cancelled`. `invoice_number` assigned only at issue. A CHECK constraint ties status to `invoice_number / issued_at / cancelled_at`. |
| `invoice_items` | Lines with **snapshots** (`sku`, `product_name`, `unit_price_minor`, `line_total_minor = quantity × unit_price_minor` enforced by CHECK). |
| `stock_movements` | Append-only audit log: type, signed `delta`, `quantity_before`, `quantity_after` (CHECK `after = before + delta`), reason, invoice link. |
| `owner_settings` | Business header, currency, low-stock default, language, invoice prefix, and the per-owner invoice counter. |

Ownership is enforced three ways: every row has `owner_id`; child tables use **composite foreign keys** `(id, owner_id)` so a line or movement can never point at another owner's invoice/product; and RLS policies filter by `auth.uid()`.

### Privileges

- `anon` (signed-out): no table privileges, no function EXECUTE.
- `authenticated`: `SELECT` only on the five tables (RLS limits rows to the owner), plus `EXECUTE` on the guarded functions.
- Supabase's broad default grants are explicitly **revoked** in the migration (a policy alone does not remove them).
- Every function is `SECURITY DEFINER` with `SET search_path = ''`, fully qualified names, and an explicit `auth.uid()` check (`private.require_owner()`). Helpers live in a `private` schema that the Data API does not expose.

### Defence in depth (triggers)

- `stock_movements`: UPDATE/DELETE forbidden.
- `invoices`: only `draft → issued → cancelled`; an issued invoice's content is frozen; only drafts can be deleted.
- `invoice_items`: can only change while the parent invoice is a draft.
- Unique index `(invoice_id, product_id, movement_type)` makes a second sale or cancellation movement for the same invoice/product impossible at the storage level.

## 3. Why issuing an invoice is atomic and safe

A PostgreSQL function call runs inside a single transaction. `issue_invoice(invoice_id, expected_total_minor)` does, in order:

1. `SELECT … FOR UPDATE` the invoice row (owner-checked). A second request for the same invoice **waits here**, then sees `status = 'issued'` and returns `already_processed = true` without touching stock (idempotent; double-click and two tabs are safe).
2. Rejects `cancelled` invoices and empty invoices.
3. Locks every product on the invoice with `SELECT … ORDER BY id FOR UPDATE`. A **fixed lock order** means two invoices sharing products cannot deadlock; a concurrent sale of the same SKU waits for the first to commit and then sees the reduced quantity.
4. Validates against the locked rows, **aggregating quantities per product** (the same SKU on two lines is checked as one total). Archived products and insufficient stock raise an error.
5. Re-snapshots SKU and name, recomputes every line total on the server, and compares the total with `expected_total_minor` (what the owner reviewed). A mismatch aborts.
6. Subtracts stock and writes one `sale` movement per product.
7. Takes the next invoice number from `owner_settings` (row lock → no duplicates).
8. Changes the status to `issued`.

Any `RAISE` in any step rolls back **everything**: no partial deduction, no movement, no number used, status stays `draft`. The `CHECK (quantity_on_hand >= 0)` constraint is a final safety net against negative stock.

`cancel_invoice` mirrors this: lock invoice → require `issued` (a repeated call finds `cancelled` and returns `already_processed`) → lock products in id order → add back the quantities from the frozen line snapshots → one `cancellation` movement per product → status `cancelled`.

Drafts (`save_draft_invoice`) never touch stock. The editor's "Issue" button first saves the draft exactly as shown, then calls `issue_invoice` with the total shown on screen.

## 4. Money and numbers

- Stored as integer minor units (`bigint`), e.g. 19.95 → `1995`.
- Parsed from text without floating point (`src/lib/numbers.ts`, also accepts Arabic-Indic digits), totals summed with `BigInt`.
- The database recomputes and checks every line total and invoice total; the browser's math is only a preview.
- One currency per invoice (copied from settings when the draft is created). Supported: ILS (default), USD, EUR.

## 5. Interface

- `src/lib/i18n/dictionaries.ts`: all Arabic and English text. TypeScript fails the build if an Arabic key is missing.
- The language is stored in a cookie (and in `owner_settings.locale`); the root layout sets `<html lang dir>`. Tailwind logical utilities (`ms-`, `ps-`, `start-`, `text-start`) make the same markup work in RTL and LTR.
- SKUs, numbers and prices are wrapped in `.ltr-value` (`direction: ltr; unicode-bidi: isolate`) so they read correctly inside Arabic text.
- Dates are stored in UTC and displayed in `Asia/Hebron` (from `owner_settings.timezone`).
- The invoice page is the printable A4 document; `@media print` hides navigation and controls, and the browser's print dialog provides "Save as PDF".

## 6. Tests

- `tests/unit`: money parsing/formatting and exact totals.
- `tests/db`: real PostgreSQL, real migrations, calls made as `anon` / `authenticated` with JWT claims exactly like PostgREST. Covers every acceptance scenario, including real concurrent transactions. Runs on plain PostgreSQL (with `tests/db/supabase-shim.sql`) or on the official `supabase/postgres` image.
- `tests/e2e/smoke.mjs`: Playwright browser run of the daily workflow, checking the database after each step.

See `TEST-RESULTS.md` for what was actually run.
