import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationType, NotificationChannel } from '@/generated/prisma'

export const runtime = 'nodejs'

// Trainer-audience prefs are scoped to the active organisation (a multi-org
// trainer tunes each org independently); client-audience prefs stay global
// (companyId null). Returns the company a given type's prefs live under.
function prefCompanyId(type: NotificationType, activeCompanyId: string | null): string | null {
  return NOTIFICATION_TYPES[type]?.audience === 'client' ? null : activeCompanyId
}

// Resolve WHOSE preferences this request acts on.
//
//  • No target (or the target is the caller) → the self path, unchanged: the
//    signed-in user, scoped to their active company from getTrainerContext.
//  • A different target → an owner/manager editing a team member's prefs. This
//    is authorised BEFORE any read/write and mirrors exactly what
//    /api/trainer/team/[membershipId] + team-panel enforce:
//      (a) the actor must hold `team.manage`;
//      (b) the target must be a TrainerMembership of the company the actor
//          manages (a SHARED company) — proven by looking it up, never trusted
//          from the request;
//      (c) the target must not be the OWNER (team-panel forbids editing them).
//    On any failure we return a status and the caller writes nothing. The
//    company written is always the SHARED company, never arbitrary input.
type Resolved =
  | { ok: true; userId: string; companyId: string | null }
  | { ok: false; status: number }

async function resolveTarget(sessionUserId: string, targetUserId: string | null | undefined): Promise<Resolved> {
  const ctx = await getTrainerContext()
  const activeCompanyId = ctx?.companyId ?? null

  // Self path — identical behaviour to before this feature.
  if (!targetUserId || targetUserId === sessionUserId) {
    return { ok: true, userId: sessionUserId, companyId: activeCompanyId }
  }

  // Editing another user's prefs requires the team-management permission.
  if (!ctx || !can('team.manage', ctx.role, ctx.permissions)) {
    return { ok: false, status: 403 }
  }

  // The target must be a member of the company the actor manages. This both
  // proves the shared-company relationship and yields the target's role.
  const target = await prisma.trainerMembership.findUnique({
    where: { companyId_userId: { companyId: ctx.companyId, userId: targetUserId } },
    select: { role: true },
  })
  if (!target) return { ok: false, status: 403 }

  // Mirror team-panel / the PATCH route: the OWNER's settings can't be edited.
  if (target.role === 'OWNER') return { ok: false, status: 403 }

  // Act as the target, scoped to the SHARED company (the actor's), never input.
  return { ok: true, userId: targetUserId, companyId: ctx.companyId }
}

// GET — return one row per (type, channel) the user is allowed to see, with
// stored values overlaid on defaults. Settings UI hydrates from this.
export async function GET(req?: Request) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    // Optional ?userId= targets a team member's prefs (owner/manager only).
    const targetUserId = req ? new URL(req.url).searchParams.get('userId') : null
    const resolved = await resolveTarget(session.user.id, targetUserId)
    if (!resolved.ok) return NextResponse.json({ error: 'Forbidden' }, { status: resolved.status })
    const { userId, companyId: activeCompanyId } = resolved

    const stored = await prisma.notificationPreference.findMany({
      where: { userId },
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
  // Optional: edit a team member's prefs instead of your own. Authorised in
  // resolveTarget (team.manage + shared, non-OWNER membership) before any write.
  targetUserId: z.string().optional(),
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

    const resolved = await resolveTarget(session.user.id, data.targetUserId)
    if (!resolved.ok) return NextResponse.json({ error: 'Forbidden' }, { status: resolved.status })
    const { userId, companyId: activeCompanyId } = resolved
    const companyId = prefCompanyId(data.type as NotificationType, activeCompanyId)
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
      where: { userId, companyId, type: data.type as NotificationType, channel: data.channel as NotificationChannel },
      select: { id: true },
    })
    const saved = existing
      ? await prisma.notificationPreference.update({ where: { id: existing.id }, data: writable })
      : await prisma.notificationPreference.create({
          data: { userId, companyId, type: data.type as NotificationType, channel: data.channel as NotificationChannel, ...writable },
        })

    return NextResponse.json({ ok: true, preference: saved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[notification-preferences PUT] crashed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
