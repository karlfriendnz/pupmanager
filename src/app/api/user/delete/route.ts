import { NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { recordAudit, auditRequestMeta } from '@/lib/audit'
import { notifyTrainerDeletion } from '@/lib/notify-new-trainer'

// Self-serve account deletion. Previously this hard-deleted the user (cascading
// away an entire trainer's business) on a single DELETE with no re-auth, CSRF
// check, grace period, or audit — a severe footgun / CSRF target.
//
// Now: same-origin required, re-authentication required (password for credential
// users, or typing DELETE for OAuth-only accounts), and we SOFT-delete by
// setting deactivatedAt. The NextAuth signIn callback already treats that as a
// hard block, so the account is immediately unusable but recoverable for a grace
// period (support can clear it within 30 days; a later cron hard-deletes), which
// avoids irreversibly destroying shared business data on one click. Audited.

const schema = z.object({
  password: z.string().min(1).max(200).optional(),
  confirm: z.string().max(40).optional(),
  // Optional free-text reason for cancelling — emailed to the founders.
  reason: z.string().max(2000).optional(),
  // Trainer consents to a follow-up call from Brooke.
  okToCall: z.boolean().optional(),
})

export async function DELETE(req: Request) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf

  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const userId = session.user.id

  const limited = await enforceRateLimit({ key: `account-delete:${userId}`, limit: 5, windowMs: 15 * 60_000 })
  if (limited) return limited

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, deactivatedAt: true, name: true, email: true, role: true,
      trainerProfile: { select: { businessName: true, phone: true } },
      accounts: { select: { provider: true, providerAccountId: true } },
    },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (user.deactivatedAt) return NextResponse.json({ ok: true, alreadyScheduled: true })

  // Re-authenticate.
  const cred = user.accounts.find(a => a.provider === 'credentials')
  if (cred?.providerAccountId) {
    const ok = parsed.data.password ? await bcrypt.compare(parsed.data.password, cred.providerAccountId) : false
    if (!ok) return NextResponse.json({ error: 'Password is incorrect.' }, { status: 403 })
  } else if (parsed.data.confirm?.trim().toUpperCase() !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 403 })
  }

  await prisma.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } })

  await recordAudit({
    action: 'ACCOUNT_DELETION_REQUESTED',
    actorUserId: userId,
    companyId: session.user.trainerId ?? null,
    targetType: 'user',
    targetId: userId,
    meta: { reason: parsed.data.reason?.trim() || null },
    ...auditRequestMeta(req),
  })

  // Heads-up to the founders with the cancellation reason. Trainers only — a
  // client self-deleting isn't a churn signal. Fire-and-forget; never block.
  if (user.role === 'TRAINER') {
    await notifyTrainerDeletion({
      name: user.name ?? '(no name)',
      businessName: user.trainerProfile?.businessName || '(no business name)',
      email: user.email,
      phone: user.trainerProfile?.phone ?? null,
      reason: parsed.data.reason ?? null,
      okToCall: parsed.data.okToCall ?? false,
    }).catch(err => console.error('[delete] founder notify failed:', err))
  }

  return NextResponse.json({
    ok: true,
    message: 'Your account is deactivated and scheduled for permanent deletion in 30 days. Contact support to undo.',
  })
}
