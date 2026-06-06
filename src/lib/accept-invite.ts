import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { notifyTrainer } from '@/lib/trainer-notify'

export type AcceptedInviteUser = {
  id: string
  email: string
  name: string | null
  role: string
}

export type AcceptInviteResult =
  | { ok: true; user: AcceptedInviteUser }
  | { ok: false; error: string; code: 'invalid' | 'expired' | 'no_user' }

// Validate a one-time invite token and "accept" it: mark the email verified,
// optionally set a password (so the invitee can sign in with email + password,
// e.g. in the native app), stamp any pending team-membership as accepted, and
// consume (delete) the token. Returns the user so the caller can establish a
// session directly — no second magic-link email required.
//
// Password is optional: if omitted, the invitee is still signed in and can use
// magic-link sign-in as the backup. If provided, it's stored exactly like a
// trainer's password — a bcrypt hash in a `credentials` Account row — so the
// existing Credentials provider authorises them.
//
// Single-use by design: the token row is deleted inside the transaction, so a
// replay finds nothing and fails as 'invalid'. The token itself is 32 random
// bytes (see /api/clients/invite + /api/trainer/team), so it's not guessable —
// possession proves control of the invited inbox, the same trust basis as a
// magic link.
export async function acceptInvite(
  token: string,
  email: string,
  password?: string,
): Promise<AcceptInviteResult> {
  const record = await prisma.verificationToken.findUnique({ where: { token } })

  if (!record || record.identifier !== email) {
    return { ok: false, error: 'Invalid invitation token.', code: 'invalid' }
  }
  if (record.expires < new Date()) {
    return { ok: false, error: 'Invitation has expired.', code: 'expired' }
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true },
  })
  if (!user) {
    return { ok: false, error: 'No account found for this invitation.', code: 'no_user' }
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null

  await prisma.$transaction([
    prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    }),
    // Replace any existing credentials account so re-accepting with a new
    // password is idempotent (fresh invitees have none).
    ...(passwordHash
      ? [
          prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } }),
          prisma.account.create({
            data: {
              userId: user.id,
              type: 'credentials',
              provider: 'credentials',
              providerAccountId: passwordHash,
            },
          }),
        ]
      : []),
    // Idempotent — a no-op for client invites (no membership), stamps the
    // pending membership accepted for team invites.
    prisma.trainerMembership.updateMany({
      where: { userId: user.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ])

  // Tell the trainer(s) their invited client just activated their account.
  if (user.role === 'CLIENT') {
    try {
      const profiles = await prisma.clientProfile.findMany({
        where: { userId: user.id },
        select: { id: true, dog: { select: { name: true } }, trainer: { select: { user: { select: { id: true } } } } },
      })
      for (const p of profiles) {
        if (!p.trainer?.user?.id) continue
        await notifyTrainer(
          p.trainer.user.id,
          'NEW_CLIENT_INVITE_ACCEPTED',
          { clientName: user.name ?? 'A new client', dogName: p.dog?.name ?? 'their dog' },
          `/clients/${p.id}`,
        )
      }
    } catch (err) {
      console.error('[accept-invite] notify failed:', err instanceof Error ? err.message : 'unknown')
    }
  }

  return { ok: true, user: { id: user.id, email: user.email!, name: user.name, role: user.role } }
}
