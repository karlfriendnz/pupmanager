import { prisma } from '@/lib/prisma'

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
// stamp any pending team-membership as accepted, and consume (delete) the
// token. Returns the user so the caller can establish a session directly —
// no second magic-link email required.
//
// Single-use by design: the token row is deleted inside the transaction, so a
// replay finds nothing and fails as 'invalid'. The token itself is 32 random
// bytes (see /api/clients/invite + /api/trainer/team), so it's not guessable —
// possession proves control of the invited inbox, the same trust basis as a
// magic link.
export async function acceptInvite(token: string, email: string): Promise<AcceptInviteResult> {
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

  await prisma.$transaction([
    prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    }),
    // Idempotent — a no-op for client invites (no membership), stamps the
    // pending membership accepted for team invites.
    prisma.trainerMembership.updateMany({
      where: { userId: user.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ])

  return { ok: true, user: { id: user.id, email: user.email!, name: user.name, role: user.role } }
}
