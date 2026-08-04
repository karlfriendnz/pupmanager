// Shared helpers for the FIRST-RUN JOURNEY audit (signup agent).
// Read-only against the LOCAL dev DB (pupmanager_dev) and dev server :7777.
// Never production.
import { Client } from 'pg'

export const BASE = 'http://localhost:7777'
export const DB_URL = 'postgresql://karl@localhost:5432/pupmanager_dev'

let ipCounter = Math.floor(Math.random() * 60000)
/** Fresh spoofed client IP per call so per-IP rate limits don't mask findings.
 *  Random base per process so reruns never land on an already-spent window. */
export function freshIp(): string {
  ipCounter++
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

export async function api(
  path: string,
  init: (RequestInit & { ip?: string }) = {},
): Promise<{ status: number; body: any; text: string; headers: Headers }> {
  const ip = init.ip ?? freshIp()
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, body, text, headers: res.headers }
}

export async function db<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL })
  await c.connect()
  try {
    const r = await c.query(sql, params)
    return r.rows as T[]
  } finally {
    await c.end()
  }
}

const RESULTS: { id: string; ok: boolean; note: string }[] = []
export function record(id: string, ok: boolean, note: string) {
  RESULTS.push({ id, ok, note })
  console.log(`${ok ? '  ok  ' : 'FIND  '} ${id}  — ${note}`)
}
export function summary() {
  const bad = RESULTS.filter(r => !r.ok)
  console.log(`\n=== ${RESULTS.length - bad.length}/${RESULTS.length} ok, ${bad.length} findings ===`)
  bad.forEach(b => console.log(`  FINDING ${b.id}: ${b.note}`))
}

export const stamp = Date.now()
export const testEmail = (tag: string) => `signupaudit.${tag}.${stamp}@pupaudit.test`

/** Register (no-password path) and return the OTP straight from the DB. */
export async function registerLead(email: string, over: Record<string, any> = {}) {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Audit Person', businessName: 'Audit Kennels',
      phone: '+64 21 555 0000', email, signupCountry: 'NZ', ...over,
    }),
  })
  return r
}

export async function latestOtp(email: string): Promise<string | null> {
  const rows = await db(
    `select token from verification_tokens where identifier = $1 order by expires desc limit 1`,
    [email],
  )
  return rows[0]?.token ?? null
}
