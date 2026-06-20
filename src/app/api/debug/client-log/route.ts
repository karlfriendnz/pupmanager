import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

// Lightweight client-event logger. Beacons from the WebView land here
// and we shovel them into the platform log (Vercel function logs in
// prod, terminal in dev) — that way when the iOS WebView crashes
// mid-flow we can still see the last step it reached. No DB write,
// no rate limiting; the volume is tiny and the surface is auth-only.
export async function POST(req: Request) {
  const session = await auth().catch(() => null)
  let body: { event?: string; data?: unknown } = {}
  try { body = await req.json() } catch { /* ignore — log empty */ }
  // Unauthenticated (beacons fire pre-auth), so cap what an anonymous caller can
  // push into our function logs — truncate so it can't be used to flood/bloat.
  const event = String(body.event ?? 'unknown').slice(0, 120)
  let data: string | null = null
  if (body.data != null) {
    try { data = JSON.stringify(body.data).slice(0, 1000) } catch { data = null }
  }
  console.log('[client-log]', JSON.stringify({
    user: session?.user?.id ?? 'anon',
    role: session?.user?.role ?? null,
    event,
    data,
    ua: (req.headers.get('user-agent') ?? '').slice(0, 200),
    at: new Date().toISOString(),
  }))
  return NextResponse.json({ ok: true })
}
