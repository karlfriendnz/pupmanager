import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationType, NotificationChannel } from '@prisma/client'

export const runtime = 'nodejs'

// GET — return one row per (type, channel) the user is allowed to see, with
// stored values overlaid on defaults. Settings UI hydrates from this.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const stored = await prisma.notificationPreference.findMany({
      where: { userId: session.user.id },
    })
    const key = (t: string, c: string) => `${t}:${c}`
    const byKey = new Map(stored.map(s => [key(s.type, s.channel), s]))

    const rows = Object.values(NOTIFICATION_TYPES).flatMap(meta =>
      meta.channels.map(channel => {
        const s = byKey.get(key(meta.type, channel))
        return {
          type: meta.type,
          channel,
          enabled: s?.enabled ?? meta.defaults.enabled,
          minutesBefore: s?.minutesBefore ?? meta.defaults.minutesBefore ?? null,
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
  channel: z.enum(['PUSH', 'EMAIL']),
  enabled: z.boolean().optional(),
  minutesBefore: z.number().int().min(1).max(7 * 24 * 60).nullable().optional(),
  dailyAtHour: z.number().int().min(0).max(23).nullable().optional(),
  customTitle: z.string().max(200).nullable().optional(),
  customBody: z.string().max(500).nullable().optional(),
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

    const where = { userId_type_channel: { userId: session.user.id, type: data.type as NotificationType, channel: data.channel as NotificationChannel } }
    const writable = {
      enabled: data.enabled ?? meta.defaults.enabled,
      minutesBefore: data.minutesBefore ?? null,
      dailyAtHour: data.dailyAtHour ?? null,
      customTitle: data.customTitle ?? null,
      customBody: data.customBody ?? null,
    }

    const saved = await prisma.notificationPreference.upsert({
      where,
      create: { userId: session.user.id, type: data.type as NotificationType, channel: data.channel as NotificationChannel, ...writable },
      update: writable,
    })

    return NextResponse.json({ ok: true, preference: saved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[notification-preferences PUT] crashed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
