import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { NOTIFICATION_TYPES, renderTemplate } from '@/lib/notification-types'
import { resolvePref } from '@/lib/notification-prefs'
import type { NotificationType } from '@/generated/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Body: { type, channel, customTitle?, customBody? }
// The optional customTitle/customBody let the UI preview unsaved edits — if
// either is provided, we use them instead of the stored values, otherwise
// resolvePref fills in stored or default copy.
const schema = z.object({
  type: z.string(),
  channel: z.enum(['PUSH', 'EMAIL']),
  customTitle: z.string().max(200).optional(),
  customBody: z.string().max(500).optional(),
})

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

    const meta = NOTIFICATION_TYPES[parsed.data.type as NotificationType]
    if (!meta) return NextResponse.json({ error: 'Unknown type' }, { status: 400 })

    const resolved = await resolvePref(session.user.id, meta.type, parsed.data.channel)
    const titleTemplate = parsed.data.customTitle ?? resolved.title
    const bodyTemplate = parsed.data.customBody ?? resolved.body

    const title = `[Test] ${renderTemplate(titleTemplate, meta.sampleValues)}`
    const body = renderTemplate(bodyTemplate, meta.sampleValues)

    if (parsed.data.channel === 'EMAIL') {
      // Email path is wired separately (Resend) — for now, a stub so the UI
      // can show "Email channel test isn't supported yet".
      return NextResponse.json({ ok: false, reason: 'email-test-not-implemented', message: 'Email test sending will land with the email cron work.' })
    }

    const tokens = await prisma.deviceToken.findMany({
      where: { userId: session.user.id, platform: 'IOS' },
    })
    if (tokens.length === 0) {
      return NextResponse.json({ ok: false, reason: 'no-devices', message: 'No iOS devices registered. Open the app on iPhone, allow notifications, then try again.' })
    }

    // Pick a realistic deep-link path so tapping the test push lands on the
    // page the real notification would. For session-related types, link to the
    // user's most recent session (or fall back to /dashboard if none exist).
    const path = await deepLinkFor(session.user.id, meta.type)

    const results = await sendApns(tokens.map(t => t.token), {
      alert: { title, body },
      customData: { type: 'preview', notificationType: meta.type, path },
    })

    const stale = results.filter(r => !r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason)).map(r => r.token)
    if (stale.length > 0) await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })

    const sent = results.filter(r => r.ok).length
    return NextResponse.json({
      ok: sent > 0,
      sent,
      failed: results.length - sent,
      preview: { title, body },
      details: results.map(r => ({ ok: r.ok, status: r.status, reason: r.reason })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, reason: 'crash', message }, { status: 500 })
  }
}

// Pick a representative deep-link target for a test push so tapping the
// notification on iPhone navigates to a realistic destination.
async function deepLinkFor(userId: string, type: NotificationType): Promise<string> {
  switch (type) {
    case 'SESSION_REMINDER':
    case 'SESSION_NOTES_REMINDER': {
      const trainerProfile = await prisma.trainerProfile.findUnique({
        where: { userId }, select: { id: true },
      })
      if (!trainerProfile) return '/dashboard'
      const recent = await prisma.trainingSession.findFirst({
        where: { trainerId: trainerProfile.id },
        orderBy: { scheduledAt: 'desc' },
        select: { id: true },
      })
      if (!recent) return '/schedule'
      return type === 'SESSION_NOTES_REMINDER'
        ? `/sessions/${recent.id}#notes`
        : `/sessions/${recent.id}`
    }
    case 'NEW_MESSAGE':
      return '/messages'
    case 'NEW_CLIENT_INVITE_ACCEPTED':
      return '/clients'
    case 'CLIENT_COMPLETED_TASKS':
      return '/dashboard'
    case 'DAILY_SUMMARY':
    default:
      return '/dashboard'
  }
}
