// StockFlow doctor: checks your setup and explains problems in Arabic + English.
//   Windows:  npm.cmd run doctor
//   Others:   npm run doctor
// It only uses the PUBLIC key from .env.local and never changes any data.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
let problems = 0;
const ok = (ar, en) => console.log(`  ✅ ${ar}\n     ${en}`);
const bad = (ar, en) => {
  problems++;
  console.log(`  ❌ ${ar}\n     ${en}`);
};
const warn = (ar, en) => console.log(`  ⚠️  ${ar}\n     ${en}`);

console.log("\nStockFlow — فحص الإعداد / setup check\n");

// 1. Node.js
const [major, minor] = process.versions.node.split(".").map(Number);
if (major > 20 || (major === 20 && minor >= 9)) ok(`Node.js ${process.versions.node}`, "Node.js version is supported");
else bad(`Node.js ${process.versions.node} قديم، ثبّت الإصدار 22 أو أحدث`, "Node.js 20.9+ is required");

// 2. .env.local
const envPath = path.join(root, ".env.local");
const env = {};
if (!existsSync(envPath)) {
  bad(
    "ملف .env.local غير موجود. انسخ .env.example إلى .env.local (في PowerShell: copy .env.example .env.local)",
    ".env.local is missing",
  );
} else {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

if (existsSync(envPath)) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) {
    bad("قيمة NEXT_PUBLIC_SUPABASE_URL غير صحيحة. يجب أن تكون مثل https://abcd.supabase.co", "Invalid NEXT_PUBLIC_SUPABASE_URL");
  } else ok("رابط Supabase مكتوب بشكل صحيح", "Supabase URL format OK");

  if (!key || key.includes("your_key_here")) {
    bad("المفتاح العام NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY فارغ", "Publishable key is empty");
  } else if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    bad(
      "خطر: وضعت المفتاح السري (secret / service_role). احذفه فورًا وضع المفتاح العام Publishable بدلًا منه",
      "DANGER: a secret/service_role key was used. Replace it with the publishable (anon) key",
    );
  } else ok("المفتاح المستخدم هو المفتاح العام (آمن)", "Publishable key looks correct");
}

// 3. Live checks against Supabase (read-only)
if (problems === 0) {
  const base = url.replace(/\/$/, "");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const res = await fetch(`${base}/rest/v1/products?select=id&limit=1`, { headers });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && body.code === "42501") {
      ok("جدول المنتجات موجود ومحمي (الزائر غير المسجّل لا يرى شيئًا)", "products table exists and is protected from anon");
    } else if (body.code === "PGRST205" || res.status === 404) {
      bad("قاعدة البيانات فارغة: شغّل الملف supabase/setup.sql في SQL Editor", "Tables not found: run supabase/setup.sql");
    } else if (res.ok) {
      bad("تحذير أمني: الجدول مقروء بدون تسجيل دخول! أعد تشغيل supabase/setup.sql", "SECURITY: products readable by anon");
    } else if (res.status === 401) {
      bad("المفتاح غير مقبول من Supabase. انسخ المفتاح العام من جديد", `Key rejected (${body.message ?? res.status})`);
    } else {
      bad(`رد غير متوقع من Supabase (${res.status})`, JSON.stringify(body));
    }

    const rpc = await fetch(`${base}/rest/v1/rpc/issue_invoice`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_invoice_id: "00000000-0000-0000-0000-000000000000", p_expected_total_minor: 0 }),
    });
    const rpcBody = await rpc.json().catch(() => ({}));
    if (rpcBody.code === "42501") ok("دالة إصدار الفاتورة موجودة ومحمية", "issue_invoice exists and anon cannot call it");
    else if (rpcBody.code === "PGRST202") bad("دوال الفواتير غير موجودة: شغّل supabase/setup.sql", "issue_invoice missing");
    else bad("دالة إصدار الفاتورة غير محمية كما يجب", `Unexpected: ${rpc.status} ${JSON.stringify(rpcBody)}`);

    const auth = await fetch(`${base}/auth/v1/settings`, { headers });
    const settings = await auth.json().catch(() => ({}));
    if (auth.ok) {
      if (settings.disable_signup) ok("التسجيل العام مغلق (فقط حسابك يدخل)", "Public sign-up is disabled");
      else
        warn(
          "التسجيل العام ما زال مفتوحًا في Supabase. أغلقه: Authentication ← Sign In / Providers ← Allow new users to sign up",
          "Public sign-up is still enabled in Supabase Auth",
        );
      if (settings.external?.email === false) bad("تسجيل الدخول بالبريد معطّل. فعّل مزوّد Email", "Email provider disabled");
    }
  } catch (err) {
    bad("تعذّر الاتصال بـ Supabase. تحقق من الإنترنت ومن الرابط، ومن أن المشروع ليس متوقفًا", String(err));
  }
}

console.log(
  problems === 0
    ? "\nكل شيء جاهز ✅  شغّل التطبيق: npm.cmd run dev\nAll good.\n"
    : `\nيوجد ${problems} مشكلة ❌ أصلحها ثم أعد الفحص.\n${problems} problem(s) found.\n`,
);
process.exit(problems === 0 ? 0 : 1);

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).role;
  } catch {
    return undefined;
  }
}
