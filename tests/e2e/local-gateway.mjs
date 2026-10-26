// =============================================================================
// TEST ONLY — local stand-in for the Supabase API gateway, used by the
// browser smoke test when the official Supabase Auth (GoTrue) service is not
// available. It is NOT part of the app and must never be deployed.
//
//   /rest/v1/*  -> proxied unchanged to a real PostgREST server (so RLS,
//                  grants and the guarded SQL functions are exercised for real)
//   /auth/v1/*  -> if AUTH_URL is set: proxied unchanged to the real Supabase
//                  Auth (GoTrue) server. Otherwise a minimal password sign-in
//                  that issues HS256 JWTs for rows in auth.users.
//
// Env: GATEWAY_PORT, POSTGREST_URL, AUTH_URL (optional), DATABASE_URL, JWT_SECRET
// =============================================================================
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.GATEWAY_PORT ?? 54500);
const POSTGREST = new URL(process.env.POSTGREST_URL ?? "http://127.0.0.1:54501");
const AUTH = process.env.AUTH_URL ? new URL(process.env.AUTH_URL) : null;
const SECRET = process.env.JWT_SECRET ?? "stockflow-local-e2e-secret-at-least-32-chars";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function signJwt(payload, secret = SECRET) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token) {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!head || !body || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

const refreshTokens = new Map();

function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJwt({
    sub: user.id,
    email: user.email,
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + 3600,
    session_id: crypto.randomUUID(),
  });
  const refresh = crypto.randomBytes(24).toString("hex");
  refreshTokens.set(refresh, user);
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: refresh,
    user: userJson(user),
  };
}

function userJson(user) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (req.method === "POST" && path === "/token" && url.searchParams.get("grant_type") === "password") {
    const { email, password } = await readJson(req);
    const { rows } = await pool.query(
      "select id, email from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)",
      [email, password],
    );
    if (!rows[0]) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    return send(res, 200, session(rows[0]));
  }
  if (req.method === "POST" && path === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const { refresh_token } = await readJson(req);
    const user = refreshTokens.get(refresh_token);
    if (!user) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
    refreshTokens.delete(refresh_token);
    return send(res, 200, session(user));
  }
  if (req.method === "GET" && path === "/user") {
    const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    if (!claims || claims.role !== "authenticated") return send(res, 403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    return send(res, 200, userJson({ id: claims.sub, email: claims.email }));
  }
  if (req.method === "POST" && path === "/logout") return send(res, 204);
  return send(res, 404, { code: 404, msg: `Not implemented in local test gateway: ${req.method} ${path}` });
}

function proxy(req, res, url, prefix, base) {
  const target = new URL(url.pathname.replace(prefix, "") + url.search, base);
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(target, { method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => send(res, 502, { message: `${base} unavailable` }));
  req.pipe(upstream);
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname.startsWith("/auth/v1")) {
        return AUTH ? proxy(req, res, url, /^\/auth\/v1/, AUTH) : await handleAuth(req, res, url);
      }
      if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, url, /^\/rest\/v1/, POSTGREST);
      send(res, 404, { message: "not found" });
    } catch (err) {
      send(res, 500, { message: String(err) });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`local test gateway on http://127.0.0.1:${PORT}`));
