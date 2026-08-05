// Who is speaking, on a booking negotiation.
//
// Both sides of the volley hit the same endpoints, so every one of them has to
// answer the same question first: is this the trainer whose request it is, or
// the client who made it, or somebody who has no business here at all? One
// resolver, so a route can never accidentally answer it more loosely than its
// neighbour.
//
// The two identities are resolved by DIFFERENT mechanisms — a trainer by their
// session's `trainerId`, a client by the active-client cookie (`getActiveClient`,
// because one client can belong to several businesses) — which is exactly why
// this is worth centralising rather than repeating.
import { auth } from './auth'
import { prisma } from './prisma'
import { getActiveClient } from './client-context'
import type { ProposalParty } from './booking-negotiation'

export interface NegotiationActor {
  party: ProposalParty
  /** The acting User — the message's senderId. */
  userId: string
  /** True for a trainer previewing the client app. Read-only, always. */
  isPreview: boolean
}

export type ActorResult =
  | { ok: true; actor: NegotiationActor }
  | { ok: false; status: number; error: string }

/**
 * Resolve the caller against ONE booking request.
 *
 * Deliberately scoped to the request rather than "are you a trainer": a trainer
 * signed into business A must not act on business B's request, and a client
 * must not act on another client's. Both are checked against the row's own
 * `trainerId` / `clientId`, which is the cross-tenant guard.
 */
export async function resolveNegotiationActor(requestId: string): Promise<ActorResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, status: 401, error: 'Unauthorised' }

  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    select: { trainerId: true, clientId: true },
  })
  // 404 rather than 403 for a request that isn't theirs: an id is guessable,
  // and "that exists but isn't yours" is itself a fact worth not handing out.
  if (!request) return { ok: false, status: 404, error: 'Not found' }

  // Trainer side — the session carries the business they are signed into.
  if (session.user.role === 'TRAINER' && session.user.trainerId) {
    if (session.user.trainerId !== request.trainerId) {
      return { ok: false, status: 404, error: 'Not found' }
    }
    return { ok: true, actor: { party: 'TRAINER', userId: session.user.id, isPreview: false } }
  }

  // Client side — the ACTIVE client profile, which is what decides which of a
  // client's businesses they are currently looking at.
  const active = await getActiveClient()
  if (active && active.clientId === request.clientId) {
    return {
      ok: true,
      actor: { party: 'CLIENT', userId: active.userId, isPreview: active.isPreview },
    }
  }

  return { ok: false, status: 404, error: 'Not found' }
}
