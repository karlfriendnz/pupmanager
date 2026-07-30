// Resolves the "active client" for any request inside the (client) route
// group. Either the signed-in client themselves, or — when a trainer has
// entered preview mode for one of their clients — the client behind the
// preview cookie. This is the one place every (client) page consults so that
// preview mode "just works" without each page needing role-aware branches.

import { cache } from 'react'
import { cookies } from 'next/headers'
import { auth } from './auth'
import { prisma } from './prisma'

export const PREVIEW_COOKIE = 'pm-preview-client'
// Pins which trainer relationship (clientProfile.id) is active for a client
// who works with more than one trainer. Set by the trainer chooser/switcher.
export const ACTIVE_TRAINER_COOKIE = 'pm-active-trainer'

export interface ActiveClient {
  clientId: string
  // The user id of the client account (NOT the trainer's). Use this whenever
  // a query needs to scope to "this client's user" — notifications, message
  // sender filters, profile fields.
  userId: string
  // True when a trainer is previewing rather than the real client logged in.
  isPreview: boolean
  // The id of the actually-signed-in user (the trainer's id when previewing).
  // Useful for telemetry / mutation guards.
  actualUserId: string
}

// Wrapped in React `cache()` so the layout and the page both call it without
// firing two separate session+cookie+DB lookups per render — important for
// staying under the Supabase pool size on deeply-rendered routes.
export const getActiveClient = cache(async (): Promise<ActiveClient | null> => {
  const session = await auth()
  if (!session) return null

  // A TRAINER looking at one of THEIR OWN clients — the preview feature.
  if (session.user.role === 'TRAINER' && session.user.trainerId) {
    const store = await cookies()
    const previewId = store.get(PREVIEW_COOKIE)?.value
    if (previewId) {
      const client = await prisma.clientProfile.findFirst({
        where: { id: previewId, trainerId: session.user.trainerId },
        select: { id: true, userId: true },
      })
      if (!client) return null
      return {
        clientId: client.id,
        userId: client.userId,
        isPreview: true,
        actualUserId: session.user.id,
      }
    }
    // No preview cookie: fall through. A trainer is often somebody else's
    // client too — they train dogs for a living and take their own dog to a
    // specialist. This used to `return null`, which bounced them out of the
    // client app entirely: Karen Backhouse owns Guiding Paws AND is a client of
    // Mersea Mutts, and could reach only the business she owns. `User.role` is
    // the DEFAULT landing surface, never the truth about access — that is
    // lib/account-access, and it has said so all along.
  }

  // Their own client relationships — one per trainer. The active one is pinned
  // by the pm-active-trainer cookie; otherwise the most recent. Scoped to
  // userId, so this can only ever resolve a profile that is genuinely theirs,
  // whatever their role says.
  const store = await cookies()
  const activeId = store.get(ACTIVE_TRAINER_COOKIE)?.value

  let client = activeId
    ? await prisma.clientProfile.findFirst({
        where: { id: activeId, userId: session.user.id },
        select: { id: true, userId: true },
      })
    : null
  if (!client) {
    client = await prisma.clientProfile.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true },
    })
  }
  if (!client) return null
  return {
    clientId: client.id,
    userId: client.userId,
    isPreview: false,
    actualUserId: session.user.id,
  }
})

/**
 * Where to send someone the (client) group could not resolve a profile for.
 *
 * Historically this was always /login, which is a redirect loop for the one
 * case that now exists: a dog owner who signed themselves up and is waiting for
 * a trainer to accept them. A ClientProfile requires a trainerId, so that
 * person legitimately has an account and no profile — /login bounces them to
 * /, which bounces them to /home, which bounces them back to /login.
 *
 * Access (not `role`) decides, so this keeps working when one login can be both
 * a trainer and a client: only somebody with NEITHER side gets the waiting
 * room. A trainer holding a stale preview cookie still lands on /login exactly
 * as before.
 */
export async function noActiveClientDestination(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) return '/login'
  const { getAccountAccess } = await import('./account-access')
  const access = await getAccountAccess(session.user.id)
  if (!access.hasClientAccess && !access.hasTrainerAccess) return '/find-trainer'
  return '/login'
}

// The client profiles (one per trainer) available to the signed-in user, for
// the trainer chooser/switcher. Empty for anyone who is nobody's client.
//
// Not gated on role: a trainer can be another trainer's client, and gating this
// on `role === 'CLIENT'` meant their switcher listed nothing — so even once they
// reached the client app they had no way to choose which trainer they were
// looking at. The `userId` filter is what makes it safe; the role never was.
export async function getClientTrainerOptions() {
  const session = await auth()
  if (!session?.user?.id) return []
  return prisma.clientProfile.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      trainer: { select: { businessName: true, logoUrl: true, emailAccentColor: true } },
    },
  })
}
