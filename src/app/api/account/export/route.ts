import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/rate-limit'
import { recordAudit, auditRequestMeta } from '@/lib/audit'

// Self-serve data export. Returns a JSON download of ONLY the authenticated
// user's permitted data — never another user's. A trainer OWNER gets their own
// business data (which they're authorized for); an invited member gets only
// their own user + membership (the business isn't theirs to export); a client
// gets only their own client profiles, dogs, sessions and form answers, scoped
// strictly by their userId.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const userId = session.user.id

  // Heavy query — keep it cheap to abuse.
  const limited = await enforceRateLimit({ key: `account-export:${userId}`, limit: 5, windowMs: 60 * 60_000 })
  if (limited) return limited

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, timezone: true, createdAt: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), account: user }

  // Trainer business data — only when this user OWNS the company they're in.
  const companyId = session.user.trainerId
  if (user.role === 'TRAINER' && companyId) {
    const ownerMembership = await prisma.trainerMembership.findFirst({
      where: { companyId, userId, role: 'OWNER' },
      select: { id: true },
    })
    if (ownerMembership) {
      const [profile, clients, sessions, packages, products, payments] = await Promise.all([
        prisma.trainerProfile.findUnique({
          where: { id: companyId },
          select: { businessName: true, phone: true, payoutCurrency: true, subscriptionStatus: true, createdAt: true },
        }),
        prisma.clientProfile.findMany({ where: { trainerId: companyId }, select: { id: true, user: { select: { name: true, email: true } }, createdAt: true } }),
        prisma.trainingSession.findMany({ where: { trainerId: companyId }, select: { id: true, title: true, scheduledAt: true, status: true }, take: 5000 }),
        prisma.package.findMany({ where: { trainerId: companyId }, select: { id: true, name: true, priceCents: true } }),
        prisma.product.findMany({ where: { trainerId: companyId }, select: { id: true, name: true, priceCents: true } }),
        prisma.payment.findMany({ where: { trainerId: companyId }, select: { id: true, amountTotal: true, currency: true, status: true, paidAt: true }, take: 5000 }),
      ])
      out.business = { profile, clients, sessions, packages, products, payments }
    } else {
      // Invited member — only their own membership, not the business.
      out.membership = await prisma.trainerMembership.findFirst({ where: { companyId, userId }, select: { role: true, title: true, acceptedAt: true } })
    }
  }

  // Client data — scoped strictly to this user's own client profiles.
  const clientProfiles = await prisma.clientProfile.findMany({
    where: { userId },
    select: {
      id: true,
      trainer: { select: { businessName: true } },
      dogs: { select: { name: true, breed: true, dob: true, notes: true } },
      trainingSessions: { select: { title: true, scheduledAt: true, status: true }, take: 2000 },
      classEnrollments: { select: { status: true, type: true, classRun: { select: { name: true } } } },
      customFieldValues: { select: { value: true, field: { select: { label: true } } } },
    },
  })
  if (clientProfiles.length) out.clientProfiles = clientProfiles

  await recordAudit({
    action: 'DATA_EXPORTED',
    actorUserId: userId,
    companyId: companyId ?? null,
    ...auditRequestMeta(req),
  })

  return new NextResponse(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="pupmanager-export-${userId}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
