import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { dismissNudge } from '@/lib/nudge-dismissals'

export const runtime = 'nodejs'

const schema = z.object({
  // Bounded so a rogue caller can't stuff the table with huge keys. Real ids
  // are short slugs like "finances-payments".
  nudgeId: z.string().min(1).max(100),
})

// Remember a "Not now" (or a CTA click) on an add-on nudge, so it stays gone
// on every device rather than just the browser it was dismissed in.
// Always scoped to the signed-in user — the id in the body is only the nudge
// key, never a user id.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  await dismissNudge(session.user.id, parsed.data.nudgeId)
  return NextResponse.json({ ok: true })
}
