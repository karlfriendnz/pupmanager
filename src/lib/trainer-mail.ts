// The one place that answers "has this address stopped receiving our mail?".
//
// Called from `sendEmail` so every sender — event-driven routes, the notify
// helpers, and the cron jobs that talk to Resend themselves — inherits the
// rule without a per-call-site check. See `trainerMailStopped` in lib/access
// for the rule itself; this module only does the lookup.

import { prisma } from '@/lib/prisma'
import { trainerMailStopped } from '@/lib/access'

/**
 * True when `to` belongs to a trainer we've stopped mailing (cancelled, lapsed
 * trial, or a closed account).
 *
 * Only OWNER accounts have a TrainerProfile, so invited staff and every client
 * address fall straight through. Fails OPEN — if the lookup errors we send the
 * email, because losing mail to a database hiccup is far worse than sending one
 * we meant to hold.
 */
export async function isTrainerMailStopped(to: string | string[]): Promise<boolean> {
  // Multi-recipient sends are internal alerts to the team, never trainer mail.
  if (Array.isArray(to)) return false
  const address = to.trim().toLowerCase()
  if (!address) return false

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: address, mode: 'insensitive' } },
      select: {
        deactivatedAt: true,
        trainerProfile: {
          select: {
            subscriptionStatus: true,
            trialEndsAt: true,
            stripeSubscriptionId: true,
            gracePeriodUntil: true,
          },
        },
      },
    })
    // No account, or an account that owns no business (a client, or invited
    // staff) — nothing here to suppress.
    if (!user?.trainerProfile) return false
    return trainerMailStopped({ ...user.trainerProfile, deactivatedAt: user.deactivatedAt })
  } catch (err) {
    console.error('[trainer-mail] suppression lookup failed — sending anyway:', err)
    return false
  }
}
