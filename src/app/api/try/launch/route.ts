import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  TRY_LAUNCH_PER_IP,
  TRY_LAUNCH_PER_LEAD,
  TRY_LAUNCH_WINDOW_MS,
  TRY_LEAD_COOKIE,
  TRY_MAX_CONCURRENT_SANDBOXES,
  tryLaunchSchema,
} from '@/lib/demo-lead'
import {
  DEMO_HARD_MINUTES,
  ENTRY_TOKEN_TTL_MS,
  createDemoTenant,
  mintEntryToken,
  purgeDemoTenant,
} from '@/lib/demo-tenant'

// POST /api/try/launch — step 2 of the trade-show "Try It" flow.
//
// Takes the persona, builds a private sandbox tenant, seeds it with data that
// reads like that trade, and hands back a one-time token the browser exchanges
// for a session. This is the expensive half — around 110 database round trips —
// so it carries the tighter limits and the concurrency ceiling.
//
// The visitor is identified by the httpOnly cookie set at step 1, never by an
// id in the body: a lead id in a request body is a lead id anybody can type.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const ip = getClientIp(req)

  const leadId = (await cookies()).get(TRY_LEAD_COOKIE)?.value
  if (!leadId) {
    return NextResponse.json({ error: 'Start again from the beginning.', restart: true }, { status: 401 })
  }

  const perIp = await enforceRateLimit({
    key: `try-launch:${ip}`,
    limit: TRY_LAUNCH_PER_IP,
    windowMs: TRY_LAUNCH_WINDOW_MS,
  })
  if (perIp) return perIp

  // A second limit on the LEAD, not the address. Spinning up sandboxes from a
  // dozen phones on the same cookie is the shape abuse takes when the per-IP
  // limit is the only one.
  const perLead = await enforceRateLimit({
    key: `try-launch-lead:${leadId}`,
    limit: TRY_LAUNCH_PER_LEAD,
    windowMs: TRY_LAUNCH_WINDOW_MS,
  })
  if (perLead) return perLead

  const lead = await prisma.demoLead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, companyName: true },
  })
  if (!lead) {
    return NextResponse.json({ error: 'Start again from the beginning.', restart: true }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const parsed = tryLaunchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Pick what kind of business you run.' }, { status: 400 })
  }

  // The ceiling. Nobody gets to make sandbox number four thousand, however many
  // IPs and cookies they have.
  const live = await prisma.demoSession.count({ where: { status: 'ACTIVE' } })
  if (live >= TRY_MAX_CONCURRENT_SANDBOXES) {
    return NextResponse.json(
      { error: 'Lots of people are trying this right now. Give it a minute and tap again.' },
      { status: 503, headers: { 'Retry-After': '60' } },
    )
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEMO_HARD_MINUTES * 60_000)

  // The session row comes FIRST and owns the id, because the tenant's marker
  // column points at it. Building the tenant first would mean a moment where a
  // tenant exists that the purge would refuse to touch.
  const demoSession = await prisma.demoSession.create({
    data: {
      leadId: lead.id,
      persona: parsed.data.persona,
      status: 'ACTIVE',
      startedAt: now,
      lastSeenAt: now,
      expiresAt,
    },
    select: { id: true },
  })

  // Now we know what they came to look at.
  await prisma.demoLead.update({
    where: { id: lead.id },
    data: { persona: parsed.data.persona },
  })

  let trainerId: string
  let ownerUserId: string
  try {
    const created = await createDemoTenant(prisma, {
      sessionId: demoSession.id,
      visitorName: lead.name,
      companyName: lead.companyName,
      persona: parsed.data.persona,
      expiresAt,
    })
    trainerId = created.trainerId
    ownerUserId = created.ownerUserId
  } catch (err) {
    console.error('[try/launch] seeding failed', err)
    // The lead survives — that is the whole point. Mark the visit failed so the
    // sweep does not keep looking for a tenant that never finished.
    await prisma.demoSession.update({
      where: { id: demoSession.id },
      data: { status: 'FAILED', endedAt: new Date() },
    }).catch(() => {})
    return NextResponse.json(
      { error: 'We could not set that up just now. Give it another tap.' },
      { status: 500 },
    )
  }

  // Complete the pairing the purge checks for. Until this write lands, the
  // tenant's demoSessionId names a session whose own trainerId is null — and
  // `purgeDemoTenant` refuses that, on purpose. The recovery is below.
  const { raw, hash } = mintEntryToken()
  try {
    await prisma.demoSession.update({
      where: { id: demoSession.id },
      data: {
        trainerId,
        ownerUserId,
        entryTokenHash: hash,
        entryTokenExpires: new Date(Date.now() + ENTRY_TOKEN_TTL_MS),
        lastSeenAt: new Date(),
      },
    })
  } catch (err) {
    // Pair the row up so the purge will accept it, then take the tenant back
    // out immediately. A tenant nobody can sign into and nothing can delete is
    // the one outcome worse than a failed launch.
    console.error('[try/launch] could not attach tenant to session', err)
    await prisma.demoSession.update({ where: { id: demoSession.id }, data: { trainerId } }).catch(() => {})
    await purgeDemoTenant(prisma, trainerId).catch(() => {})
    await prisma.demoSession.update({
      where: { id: demoSession.id },
      data: { status: 'FAILED', endedAt: new Date() },
    }).catch(() => {})
    return NextResponse.json({ error: 'We could not set that up just now. Give it another tap.' }, { status: 500 })
  }

  // The raw token leaves the building exactly once, and is single-use. See the
  // `demo-entry` provider in lib/auth.
  return NextResponse.json({ ok: true, token: raw, expiresAt: expiresAt.toISOString() })
}
