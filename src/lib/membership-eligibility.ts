import { prisma } from './prisma'

// WHO may join a package, as opposed to whether it can be paid for
// (client-memberships.ts `resolveBuyability`). The two are deliberately
// separate: "you haven't earned this yet" and "your trainer hasn't set up
// payments" are different sentences and different fixes.
//
// THE LADDER. Karl, 2026-08-01: "juniors can't necessarily go into a senior
// package." So a gate is a PREREQUISITE — a thing you have already done —
// rather than a permission that can be granted and taken away. Three
// consequences follow, and all three are load-bearing:
//
//   1. Checked ONLY at the point of joining. A trainer who adds a harder
//      prerequisite next month must not thereby evict the people already
//      paying. Existing subscribers are eligible by virtue of subscribing.
//   2. It cannot lapse. Achievements are permanent, so nobody is ever locked
//      out mid-subscription by something expiring.
//   3. ALL prerequisites, never any-of. A ladder is a sequence; "any one of
//      these" lets someone skip a rung.
//
// An INVITE overrides everything. A trainer who names a specific client has
// made a deliberate decision about that client, and the ladder is a default for
// when they haven't.

export type EligibilityMode = 'PUBLIC' | 'ACHIEVEMENT' | 'INVITE_ONLY'

export interface EligibilityInput {
  mode: EligibilityMode
  /** Achievement ids this package requires — ALL of them. */
  requires: string[]
  /** Achievement ids this client already holds. */
  holds: Set<string>
  /** The trainer named this client specifically. Overrides the mode. */
  invited: boolean
  /** Already on it — the gate is behind them and must not swing shut. */
  subscribed: boolean
}

export interface EligibilityResult {
  eligible: boolean
  /** Why not, for the card. Null when eligible. */
  lockedReason: 'ACHIEVEMENT' | 'INVITE_ONLY' | null
  /** Prerequisite achievement ids still outstanding — drives "you still need…". */
  missing: string[]
}

/**
 * The single eligibility rule. Pure, so the storefront, the buy route and the
 * upgrade route all reach the same answer — a card that offers a button the API
 * refuses is the failure this exists to prevent.
 */
export function resolveEligibility(input: EligibilityInput): EligibilityResult {
  // Already paying for it. Nothing below may take it away — see rule 1.
  if (input.subscribed) return { eligible: true, lockedReason: null, missing: [] }
  // A named invitation beats the mode, including INVITE_ONLY (which is just the
  // mode where the invitation is the ONLY way in).
  if (input.invited) return { eligible: true, lockedReason: null, missing: [] }

  if (input.mode === 'PUBLIC') return { eligible: true, lockedReason: null, missing: [] }
  if (input.mode === 'INVITE_ONLY') {
    return { eligible: false, lockedReason: 'INVITE_ONLY', missing: [] }
  }

  const missing = input.requires.filter(id => !input.holds.has(id))
  // A package set to ACHIEVEMENT with no prerequisites chosen is a
  // half-finished setting, not a locked door. Treating it as locked would take
  // a trainer's package off every client's screen the moment they picked the
  // mode and before they picked the achievements.
  if (input.requires.length === 0) return { eligible: true, lockedReason: null, missing: [] }
  if (missing.length === 0) return { eligible: true, lockedReason: null, missing: [] }
  return { eligible: false, lockedReason: 'ACHIEVEMENT', missing }
}

/**
 * Everything the rule needs for one client across a whole list of packages, in
 * three queries rather than three per package.
 *
 * `clientId` is optional because the public storefront has no signed-in client.
 * With none, nobody holds anything and nobody is invited — so gated packages
 * come back locked, which is the correct thing to show a stranger.
 */
export async function loadEligibilityContext(args: {
  membershipIds: string[]
  clientId?: string
}): Promise<{
  requiresByMembership: Map<string, string[]>
  holds: Set<string>
  invitedTo: Set<string>
}> {
  const requiresByMembership = new Map<string, string[]>()
  if (args.membershipIds.length === 0) {
    return { requiresByMembership, holds: new Set(), invitedTo: new Set() }
  }

  const [prereqs, awards, invites] = await Promise.all([
    prisma.membershipPrerequisite.findMany({
      where: { membershipId: { in: args.membershipIds } },
      select: { membershipId: true, achievementId: true },
    }),
    args.clientId
      ? prisma.clientAchievement.findMany({
          where: { clientId: args.clientId },
          select: { achievementId: true },
        })
      : Promise.resolve([]),
    args.clientId
      ? prisma.membershipRequest.findMany({
          where: {
            clientId: args.clientId,
            membershipId: { in: args.membershipIds },
            reason: 'INVITE',
            // DECLINED is how an invitation is withdrawn, so it must not count.
            status: { in: ['PENDING', 'FULFILLED'] },
          },
          select: { membershipId: true },
        })
      : Promise.resolve([]),
  ])

  for (const p of prereqs) {
    const list = requiresByMembership.get(p.membershipId)
    if (list) list.push(p.achievementId)
    else requiresByMembership.set(p.membershipId, [p.achievementId])
  }

  return {
    requiresByMembership,
    holds: new Set(awards.map(a => a.achievementId)),
    invitedTo: new Set(invites.map(i => i.membershipId)),
  }
}

/**
 * The eligibility answer for ONE package, for the routes that act on a single
 * id (buy, switch, request). Deliberately re-derived from the database rather
 * than trusted from the client — the storefront's copy is a hint for rendering,
 * never the gate.
 */
export async function checkEligibility(args: {
  membershipId: string
  clientId: string
  mode: EligibilityMode
  subscribed: boolean
}): Promise<EligibilityResult> {
  const ctx = await loadEligibilityContext({
    membershipIds: [args.membershipId],
    clientId: args.clientId,
  })
  return resolveEligibility({
    mode: args.mode,
    requires: ctx.requiresByMembership.get(args.membershipId) ?? [],
    holds: ctx.holds,
    invited: ctx.invitedTo.has(args.membershipId),
    subscribed: args.subscribed,
  })
}

/** Names for the achievements a client is still short of, for the card's copy. */
export async function describeMissing(achievementIds: string[]): Promise<string[]> {
  if (achievementIds.length === 0) return []
  const rows = await prisma.achievement.findMany({
    where: { id: { in: achievementIds } },
    orderBy: { order: 'asc' },
    select: { name: true },
  })
  return rows.map(r => r.name)
}
