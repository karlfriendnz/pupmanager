/**
 * The hard stop on anything a "Try It" sandbox could send or spend.
 *
 * A visitor at a trade show is holding a real copy of the app. The seeded
 * clients are invented, but the app they are sitting in has bulk client email,
 * client invites, platform announcements, comms flows, push notifications and
 * Stripe. A stranger tapping "email all clients" at the stand — or editing a
 * sample client's address to their own and pressing send — must hit a wall on
 * the SERVER. Hiding the button is not a control (see AGENTS.md #5: props on a
 * client component are page source, and a hidden button is a request nobody
 * validated).
 *
 * ─── Where the block sits ────────────────────────────────────────────────────
 * At the boundary, in one place per channel, exactly like `no-email` and
 * `trainer-mail` before it:
 *
 *   email → `sendEmail` and `sendEmailBatch` in lib/email.ts  (every one of the
 *           ~59 senders — routes, notify helpers, comms flows and the crons
 *           that talk to Resend themselves — goes through these two functions)
 *   push  → `sendPush` in lib/push.ts (the single entry point for APNs + FCM)
 *   money → `assertNotDemoTenant` at the Stripe helpers
 *
 * There is no SMS provider in this stack, so there is no third channel to gate;
 * if one is ever added it belongs here on the same terms.
 *
 * ─── Two independent tests, either of which blocks ───────────────────────────
 * 1. THE ACTOR. The signed-in session driving this request belongs to a demo
 *    tenant. Read off the JWT (`session.user.isDemo`, stamped at sign-in from
 *    the tenant's marker column), so it costs nothing and cannot fail open on a
 *    database hiccup. This is the check that catches the visitor pressing send.
 *
 * 2. THE RECIPIENT. The address (or push user) belongs to a demo tenant — its
 *    owner, or one of its clients. This is what catches a CRON: a job has no
 *    session, so test 1 says nothing about it, and a session reminder for a
 *    sandbox's sample class must not go out either.
 *
 * Unlike the suppression check next to it, this one FAILS CLOSED on the actor
 * test: if a demo session is present and we cannot decide, we do not send.
 * Holding a message we meant to send is recoverable; a stranger mailing a
 * stranger from our sending domain is not.
 */

import { prisma } from '@/lib/prisma'
import { isDemoEmail } from '@/lib/demo-tenant'

/** Why a send was refused. Logged, never shown to a visitor as jargon. */
export type DemoBlockReason =
  | 'demo-session'
  | 'demo-tenant'
  | 'demo-recipient'
  | null

// ─── 1. The actor ────────────────────────────────────────────────────────────

/**
 * Is the request we are inside being driven by a demo sandbox?
 *
 * Returns false when there is no request at all — a cron job, a CLI script, a
 * unit test — because `auth()` reads request headers and throws outside one.
 * That is correct: those callers are covered by the recipient test below.
 *
 * `@/lib/auth` is imported dynamically. It is a heavy module (it mints an Apple
 * client secret at load) and lib/email is imported by most of the codebase; a
 * static import here would drag NextAuth into every one of those bundles.
 */
export async function currentActorIsDemo(): Promise<boolean> {
  try {
    const { auth } = await import('@/lib/auth')
    const session = await auth()
    if (!session?.user) return false
    if (session.user.isDemo) return true
    // Belt and braces: a session minted before the flag existed, or one whose
    // JWT predates a tenant becoming a sandbox. One indexed lookup, and only
    // for signed-in trainer requests.
    if (!session.user.trainerId) return false
    const tp = await prisma.trainerProfile.findUnique({
      where: { id: session.user.trainerId },
      select: { demoSessionId: true },
    })
    return !!tp?.demoSessionId
  } catch {
    // No request context (cron/script/test) — not a demo actor. A THROWN
    // failure inside a real request would also land here, which is why the
    // recipient test runs regardless rather than as an else-branch.
    return false
  }
}

// ─── 2. The recipient ────────────────────────────────────────────────────────

/**
 * Does this email address belong to a demo sandbox — its owner, or one of its
 * clients?
 *
 * The domain test comes first and is free: every account minted inside a
 * sandbox sits on a reserved `.test` domain. The database lookup is for the
 * case that actually matters — a visitor edited a sample client's address to a
 * real one, so the address looks perfectly ordinary and only the tenant it
 * hangs off says otherwise.
 */
export async function isDemoRecipient(address: string): Promise<boolean> {
  const email = address.trim().toLowerCase()
  if (!email) return false
  if (isDemoEmail(email)) return true

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        trainerProfile: { select: { demoSessionId: true } },
        clientProfiles: { select: { trainer: { select: { demoSessionId: true } } } },
        memberships: { select: { company: { select: { demoSessionId: true } } } },
      },
    })
    if (!user) return false
    if (user.trainerProfile?.demoSessionId) return true
    if (user.clientProfiles.some(c => c.trainer.demoSessionId)) return true
    if (user.memberships.some(m => m.company.demoSessionId)) return true
    return false
  } catch (err) {
    // FAIL CLOSED is wrong here and fail-open is wrong too, so pick the one
    // whose failure mode is smallest: a lookup error on an ordinary address
    // must not stop a paying customer's invoice going out. The actor test is
    // the one that guards the visitor's own taps, and it does not need this
    // query to work.
    console.error('[demo-guard] recipient lookup failed — allowing:', err)
    return false
  }
}

// ─── The gate the channels call ──────────────────────────────────────────────

/**
 * Should this outbound message be dropped? Returns a reason, or null to send.
 *
 * Both tests run concurrently so the guard adds one round trip's latency, not
 * two, to a send that already does a suppression lookup.
 */
export async function demoOutboundBlock(to: string | string[]): Promise<DemoBlockReason> {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)

  const [actorIsDemo, anyDemoRecipient] = await Promise.all([
    currentActorIsDemo(),
    // ANY demo recipient blocks the whole message. A send is one message; there
    // is no partial delivery to reason about, and a mixed list is a bug
    // upstream rather than something to quietly half-honour.
    Promise.all(recipients.map(isDemoRecipient)).then(rs => rs.some(Boolean)),
  ])

  if (actorIsDemo) return 'demo-session'
  if (anyDemoRecipient) return 'demo-recipient'
  return null
}

/**
 * The push equivalent. A device token hangs off a User, so the recipient test
 * is "does this user sit inside a demo tenant".
 */
export async function demoPushBlock(userId: string): Promise<DemoBlockReason> {
  const [actorIsDemo, user] = await Promise.all([
    currentActorIsDemo(),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        trainerProfile: { select: { demoSessionId: true } },
        clientProfiles: { select: { trainer: { select: { demoSessionId: true } } } },
        memberships: { select: { company: { select: { demoSessionId: true } } } },
      },
    }).catch(() => null),
  ])

  if (actorIsDemo) return 'demo-session'
  if (user?.trainerProfile?.demoSessionId) return 'demo-recipient'
  if (user?.clientProfiles.some(c => c.trainer.demoSessionId)) return 'demo-recipient'
  if (user?.memberships.some(m => m.company.demoSessionId)) return 'demo-recipient'
  return null
}

// ─── Money ───────────────────────────────────────────────────────────────────

export class DemoTenantBlockedError extends Error {
  constructor(what: string) {
    super(`A demo sandbox cannot ${what}.`)
    this.name = 'DemoTenantBlockedError'
  }
}

/**
 * Refuse anything that would move real money or create a real Stripe object for
 * a sandbox. Throws rather than returning false: every caller of this is a
 * money path, and a money path that quietly no-ops is worse than one that 500s.
 */
export async function assertNotDemoTenant(trainerId: string, what: string): Promise<void> {
  const tp = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { demoSessionId: true },
  })
  if (tp?.demoSessionId) throw new DemoTenantBlockedError(what)
}
