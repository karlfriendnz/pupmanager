import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationType, NotificationChannel } from '@/generated/prisma'

export const runtime = 'nodejs'

// Trainer-audience prefs are scoped to the active organisation (a multi-org
// trainer tunes each org independently); client-audience prefs stay global
// (companyId null). Returns the company a given type's prefs live under.
function prefCompanyId(type: NotificationType, activeCompanyId: string | null): string | null {
  return NOTIFICATION_TYPES[type]?.audience === 'client' ? null : activeCompanyId
}

// GET — return one row per (type, channel) the user is allowed to see, with
// stored values overlaid on defaults. Settings UI hydrates from this.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const ctx = await getTrainerContext()
    const activeCompanyId = ctx?.companyId ?? null

    const stored = await prisma.notificationPreference.findMany({
      where: { userId: session.user.id },
    })
    // Prefer the active-org row, fall back to the user's global (null) row.
    const pick = (t: string, c: string, companyId: string | null) =>
      stored.find(s => s.type === t && s.channel === c && s.companyId === companyId)
      ?? stored.find(s => s.type === t && s.channel === c && s.companyId === null)

    const rows = Object.values(NOTIFICATION_TYPES).flatMap(meta =>
      meta.channels.map(channel => {
        const s = pick(meta.type, channel, prefCompanyId(meta.type, activeCompanyId))
        return {
          type: meta.type,
          channel,
          enabled: s?.enabled ?? meta.defaults.enabled,
          minutesBefore: s?.minutesBefore ?? meta.defaults.minutesBefore ?? null,
          // No stored row → seed the type's default lead, but only on the
          // channels that are on by default (so e.g. email starts empty).
          leadMinutes: s ? s.leadMinutes : ((meta.defaultChannels ?? meta.channels).includes(channel) && meta.defaults.minutesBefore ? [meta.defaults.minutesBefore] : []),
          dailyAtHour: s?.dailyAtHour ?? meta.defaults.dailyAtHour ?? null,
          customTitle: s?.customTitle ?? null,
          customBody: s?.customBody ?? null,
        }
      }),
    )

    return NextResponse.json({ preferences: rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[notification-preferences GET] crashed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

const updateSchema = z.object({
  type: z.string(),
  channel: z.enum(['PUSH', 'EMAIL', 'IN_APP']),
  enabled: z.boolean().optional(),
  minutesBefore: z.number().int().min(1).max(7 * 24 * 60).nullable().optional(),
  leadMinutes: z.array(z.number().int().min(1).max(7 * 24 * 60)).optional(),
  dailyAtHour: z.number().int().min(0).max(23).nullable().optional(),
  customTitle: z.string().max(200).nullable().optional(),
  // EMAIL-channel bodies may hold rich-text HTML, which is larger than the
  // old plain-text limit. PUSH bodies stay short but share this schema.
  customBody: z.string().max(20_000).nullable().optional(),
})

// PUT — upsert a single (type, channel) preference. Sending null for a
// custom field clears the override and falls back to the default.
export async function PUT(req: Request) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid', issues: parsed.error.issues }, { status: 400 })
    const data = parsed.data

    const meta = NOTIFICATION_TYPES[data.type as NotificationType]
    if (!meta) return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 })
    if (!meta.channels.includes(data.channel as NotificationChannel)) {
      return NextResponse.json({ error: 'Channel not supported for this type' }, { status: 400 })
    }

    const ctx = await getTrainerContext()
    const companyId = prefCompanyId(data.type as NotificationType, ctx?.companyId ?? null)
    const writable = {
      enabled: data.enabled ?? meta.defaults.enabled,
      minutesBefore: data.minutesBefore ?? null,
      leadMinutes: data.leadMinutes ?? [],
      dailyAtHour: data.dailyAtHour ?? null,
      customTitle: data.customTitle ?? null,
      customBody: data.customBody ?? null,
    }

    // findFirst + update/create rather than upsert: the unique key includes a
    // nullable companyId, which Prisma's compound-unique `where` can't target.
    const existing = await prisma.notificationPreference.findFirst({
      where: { userId: session.user.id, companyId, type: data.type as NotificationType, channel: data.channel as NotificationChannel },
      select: { id: true },
    })
    const saved = existing
      ? await prisma.notificationPreference.update({ where: { id: existing.id }, data: writable })
      : await prisma.notificationPreference.create({
          data: { userId: session.user.id, companyId, type: data.type as NotificationType, channel: data.channel as NotificationChannel, ...writable },
        })

    return NextResponse.json({ ok: true, preference: saved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[notification-preferences PUT] crashed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
