import { getSessionSecret, type Env } from "./db";
import { b64urlDecode, b64urlEncode } from "./webpush";

// Satu kata sandi keluarga (secret FAMILY_PASSWORD). Token sesi ditandatangani
// dengan kunci turunan dari kata sandi itu, jadi mengganti kata sandi otomatis
// mengeluarkan semua perangkat yang sedang masuk.

const enc = new TextEncoder();
const TOKEN_TTL_SECONDS = 180 * 24 * 3600;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function signingKey(env: Env): Promise<Uint8Array> {
  const secret = await getSessionSecret(env.DB);
  return hmac(enc.encode(secret), enc.encode(env.FAMILY_PASSWORD ?? ""));
}

export async function checkPassword(env: Env, password: string): Promise<boolean> {
  if (!env.FAMILY_PASSWORD) return false;
  const key = enc.encode("biya-password-check");
  const [a, b] = await Promise.all([hmac(key, enc.encode(password)), hmac(key, enc.encode(env.FAMILY_PASSWORD))]);
  return equalBytes(a, b);
}

export async function issueToken(env: Env, memberId: string): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify({ m: memberId, iat: Math.floor(Date.now() / 1000) })));
  const sig = await hmac(await signingKey(env), enc.encode(payload));
  return `${payload}.${b64urlEncode(sig)}`;
}

export async function verifyToken(env: Env, token: string): Promise<string | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !env.FAMILY_PASSWORD) return null;
  const expected = await hmac(await signingKey(env), enc.encode(payload));
  let given: Uint8Array;
  try {
    given = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (!equalBytes(expected, given)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { m: string; iat: number };
    if (Date.now() / 1000 - data.iat > TOKEN_TTL_SECONDS) return null;
    return data.m;
  } catch {
    return null;
  }
}

export async function loginBlocked(db: D1Database, ip: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT failures, window_start FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first<{ failures: number; window_start: string }>();
  if (!row) return false;
  if (Date.now() - Date.parse(row.window_start) > FAILURE_WINDOW_MS) return false;
  return row.failures >= MAX_FAILURES;
}

export async function recordLoginFailure(db: D1Database, ip: string): Promise<void> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO login_attempts (ip, failures, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(ip) DO UPDATE SET
         failures = CASE WHEN window_start < ?3 THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN window_start < ?3 THEN ?2 ELSE window_start END`,
    )
    .bind(ip, now, cutoff)
    .run();
}

export async function clearLoginFailures(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}
