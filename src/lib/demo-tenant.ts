/**
 * Throwaway "Try It" tenants — creating one, and destroying one safely.
 *
 * Someone at a trade show scans a QR code, gives us their details, picks the
 * kind of dog pro they are, and gets a private copy of the real app to play
 * with. This module owns the tenant on both ends: it is the ONLY thing that
 * ever writes the demo markers, and the only thing that ever deletes a tenant.
 *
 * ─── The purge safety argument ───────────────────────────────────────────────
 * Deleting the wrong `trainerId` would destroy a paying customer's business, so
 * `purgeDemoTenant` refuses unless FOUR independent facts all hold:
 *
 *   1. `TrainerProfile.demoSessionId` is set.
 *   2. `TrainerProfile.demoExpiresAt` is set.
 *   3. A DemoSession row with that id exists AND its own `trainerId` points
 *      back at this exact profile — the pairing is mutual, so a stray value in
 *      one column is not enough.
 *   4. The owning User's email sits on `DEMO_EMAIL_DOMAIN`, a reserved `.test`
 *      domain nobody can register or sign up with.
 *
 * A real customer has none of these, and cannot acquire them: the only writer
 * is `createDemoTenant` below, and the trainer-profile PATCH route validates
 * its body against a zod allow-list that contains neither column. Anything that
 * fails a check throws rather than returning quietly — a purge that silently
 * did nothing would look identical to a purge that silently did the wrong
 * thing.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient } from '@/generated/prisma'
import { resetDemoData, seedDemoData } from '@/lib/demo-seed'
import { PERSONAS } from '@/lib/onboarding-recommendations'

/**
 * Reserved domain for every account inside a demo sandbox — the owner and the
 * seeded sample clients alike.
 *
 * `.test` is reserved by RFC 2606 and can never resolve, so nothing addressed
 * here can leave the building even if every other guard failed. It is also the
 * fourth leg of the purge check: no real customer's login can end in it,
 * because sign-up validates a real address and this domain cannot receive the
 * verification code.
 */
export const DEMO_EMAIL_DOMAIN = '@try.pupmanager.test'

/** True when an address belongs to a demo sandbox account. */
export function isDemoEmail(address: string | null | undefined): boolean {
  return !!address && address.trim().toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)
}

/**
 * How long a sandbox lives.
 *
 * Two clocks, because a trade-show stand has two failure modes. IDLE_MINUTES
 * collects the majority — someone wanders off mid-tap and never presses exit.
 * HARD_MINUTES catches the phone left face-up on the counter with the screen
 * awake, where "last seen" keeps refreshing forever.
 *
 * OPEN QUESTION FOR KARL: these are a guess. 45 idle / 3 hours hard feels right
 * for a stand you walk away from, but he may want a much shorter idle window if
 * the stand is busy.
 */
export const DEMO_IDLE_MINUTES = 45
export const DEMO_HARD_MINUTES = 180

/**
 * How many sample clients a sandbox gets.
 *
 * Not the demo account's 50. A visitor is holding a phone for four minutes and
 * a shorter list reads as a real, tidy business rather than a wall; it also
 * roughly halves the number of rows the purge has to take back. Measured at
 * ~150ms locally for 12 (vs ~250ms for 50) — see the concurrency note in the
 * seed call below.
 */
export const DEMO_CLIENT_COUNT = 12

/** Persona ids we will accept from the picker — the real catalog, not a copy. */
export const DEMO_PERSONA_IDS: string[] = PERSONAS.map(p => p.id)

/** Business name shown in the sandbox, derived from what the visitor typed. */
function sandboxBusinessName(companyName: string): string {
  const trimmed = companyName.trim().slice(0, 60)
  return trimmed || 'Your Dog Business'
}

// ─── Entry tokens ────────────────────────────────────────────────────────────

/**
 * Mint a one-time entry token. The raw value goes to the browser once and is
 * exchanged for a signed-in session; only its hash is stored, so a dump of
 * `demo_sessions` is not a pile of working logins.
 */
export function mintEntryToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: hashEntryToken(raw) }
}

export function hashEntryToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Entry tokens are for the walk from the persona screen to the app. */
export const ENTRY_TOKEN_TTL_MS = 5 * 60_000

// ─── Creation ────────────────────────────────────────────────────────────────

export type CreateDemoTenantArgs = {
  /**
   * The DemoSession this tenant belongs to. Already created by the caller.
   *
   * Named `sessionId`, not `demoSessionId`, deliberately: the marker COLUMN is
   * `demoSessionId`, and a drift test (tests/unit/security/demo-tenant-marker)
   * enforces that the column name appears as a write in this file and nowhere
   * else. Naming the argument after the column would make every caller look
   * like a writer.
   */
  sessionId: string
  /** What the visitor typed on the capture screen. */
  visitorName: string
  companyName: string
  persona: string
  /** Everything after this is purgeable no matter what the visitor does. */
  expiresAt: Date
}

export type CreateDemoTenantResult = {
  trainerId: string
  ownerUserId: string
}

/**
 * Build a complete, working, isolated tenant and fill it with data that reads
 * like the visitor's own trade.
 *
 * The tenant is a NORMAL tenant in every way that matters to a query: a real
 * User, a real TrainerProfile, a real OWNER TrainerMembership. Every existing
 * `trainerId` scope therefore isolates it for free — there is no "demo mode"
 * branch in the app for a bug to slip past. The only things that differ are the
 * two marker columns, and they only ever subtract capability (no outbound mail,
 * no billing, purgeable).
 */
export async function createDemoTenant(
  prisma: PrismaClient,
  args: CreateDemoTenantArgs,
): Promise<CreateDemoTenantResult> {
  if (!DEMO_PERSONA_IDS.includes(args.persona)) {
    throw new Error(`createDemoTenant: unknown persona "${args.persona}"`)
  }

  // The login. On the reserved domain so it can never be mailed and can never
  // collide with a real account — `User.email` is unique, and a stranger cannot
  // register anything ending in `.test`.
  const email = `demo-${args.sessionId}${DEMO_EMAIL_DOMAIN}`

  const user = await prisma.user.create({
    data: {
      email,
      name: args.visitorName.trim().slice(0, 60) || 'Demo user',
      role: 'TRAINER',
      // Verified at creation: the verification gate in the (trainer) layout
      // would otherwise hold them on a screen asking for a code we can never
      // send. There is nothing to verify — we made the address.
      emailVerified: new Date(),
      // Nothing may reach this person. Belt to the demo guard's braces.
      notifyEmail: false,
      notifyPush: false,
      productEmailOptOut: true,
    },
  })

  const profile = await prisma.trainerProfile.create({
    data: {
      userId: user.id,
      businessName: sandboxBusinessName(args.companyName),
      // The (trainer) layout's profile-completion gate wants name + business +
      // phone before it lets anyone in. A visitor at a poster must not meet a
      // form, so all three are filled here. The phone is the documentation
      // example number (Ofcom's reserved range) — never anybody's line.
      phone: '+64 7 000 0000',
      showPhoneToClients: false,
      businessRoles: [args.persona],
      // ACTIVE with no trial: the paywall in the layout bounces a lapsed trial
      // to /billing/setup, and a stranger must never see a subscribe screen.
      // This is NOT a billing state anyone acts on — the demo guard blocks
      // Stripe outright and the tenant is excluded from customer counts.
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
      // Ours, not a customer's — keeps it out of real reporting and admin
      // counts that already filter on this flag.
      isInternal: true,
      // Test-mode billing, so even a code path we have not thought of cannot
      // reach live Stripe with this tenant's id.
      sandboxBilling: true,
      // ─── The markers. The only place these are ever written. ───
      demoSessionId: args.sessionId,
      demoExpiresAt: args.expiresAt,
    },
  })

  await prisma.trainerMembership.create({
    data: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
  })

  // Fill it. `seedDemoData` is the existing, persona-aware seeder — a groomer
  // gets grooms and a walker gets walks, from the same data the demo account
  // uses. `markSample` tags every row so the trainer-facing "this is sample
  // data" affordances behave; `finalize: false` because everything finalize
  // would set (ACTIVE, onboarding complete) is already set above, and its
  // `logoUrl: null` write is pointless here.
  //
  // CONCURRENCY: this is the slow part of the whole flow — roughly 110 database
  // round trips. Locally that is ~150ms; against the Supabase pooler expect
  // 1.5–4s, which is why the persona screen shows a "setting up" state rather
  // than pretending the tap was instant.
  await seedDemoData(prisma, profile.id, {
    clientCount: DEMO_CLIENT_COUNT,
    roles: [args.persona],
    reset: false,
    markSample: true,
    finalize: false,
  })

  // Onboarding is done as far as this visitor is concerned — no checklist, no
  // nudges, no drip. (The drip also skips demo tenants at the sender, see
  // lib/demo-guard; this just stops the UI nagging.)
  await prisma.trainerOnboardingProgress.upsert({
    where: { trainerId: profile.id },
    create: {
      trainerId: profile.id,
      welcomeShownAt: new Date(),
      tourStartedAt: new Date(),
      ahaReachedAt: new Date(),
      checklistDismissedAt: new Date(),
    },
    update: {},
  })

  return { trainerId: profile.id, ownerUserId: user.id }
}

// ─── Identification ──────────────────────────────────────────────────────────

/**
 * Is this tenant a throwaway sandbox? One indexed lookup on the marker column.
 *
 * Deliberately checks the marker rather than "does a DemoSession exist" — the
 * marker is on the row every tenant-scoped query already has in hand, and it
 * survives a DemoSession row being deleted by an erasure request.
 */
export async function isDemoTenant(prisma: PrismaClient, trainerId: string): Promise<boolean> {
  const row = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { demoSessionId: true },
  })
  return !!row?.demoSessionId
}

// ─── Purge ───────────────────────────────────────────────────────────────────

export class NotADemoTenantError extends Error {
  constructor(trainerId: string, reason: string) {
    super(`Refusing to purge ${trainerId}: ${reason}`)
    this.name = 'NotADemoTenantError'
  }
}

export type PurgeResult = {
  trainerId: string
  /** Sample/demo client User rows removed alongside the tenant. */
  clientUsersDeleted: number
}

/**
 * Destroy a sandbox tenant and everything in it. Throws NotADemoTenantError if
 * the target does not satisfy every check in this file's header — including
 * when the tenant simply does not exist, because "already gone" and "not a
 * demo" must not be told apart by a caller that then retries harder.
 *
 * THE LEAD IS NOT TOUCHED. Nothing here writes `demo_leads`, and the DemoSession
 * row survives as history with `status: 'PURGED'`.
 */
export async function purgeDemoTenant(prisma: PrismaClient, trainerId: string): Promise<PurgeResult> {
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      id: true,
      demoSessionId: true,
      demoExpiresAt: true,
      userId: true,
      user: { select: { id: true, email: true } },
    },
  })

  // 1 + 2 — both markers present.
  if (!profile) throw new NotADemoTenantError(trainerId, 'no such trainer profile')
  if (!profile.demoSessionId) throw new NotADemoTenantError(trainerId, 'demoSessionId is not set')
  if (!profile.demoExpiresAt) throw new NotADemoTenantError(trainerId, 'demoExpiresAt is not set')

  // 4 — the owner's login is on the reserved, unmailable domain.
  if (!isDemoEmail(profile.user?.email)) {
    throw new NotADemoTenantError(trainerId, `owner email is not on ${DEMO_EMAIL_DOMAIN}`)
  }

  // 3 — the pairing is mutual. A demoSessionId that names a session pointing at
  // some OTHER tenant is the shape a copy-paste accident would take, so it is
  // exactly what this check is for.
  const demoSession = await prisma.demoSession.findUnique({
    where: { id: profile.demoSessionId },
    select: { id: true, trainerId: true },
  })
  if (!demoSession) throw new NotADemoTenantError(trainerId, 'demoSessionId names no demo session')
  if (demoSession.trainerId !== profile.id) {
    throw new NotADemoTenantError(trainerId, 'demo session does not point back at this tenant')
  }

  // Collect the sample CLIENT logins before the tenant goes. They are separate
  // User rows (a client can belong to several businesses), so the cascade from
  // the owner will not take them — it only removes their ClientProfile.
  const clientUserIds = (await prisma.clientProfile.findMany({
    where: { trainerId: profile.id },
    select: { userId: true },
  })).map(c => c.userId).filter((id): id is string => !!id)

  // ORDER MATTERS, and not in the way it first looks.
  //
  // "Delete the owner; the cascade does the rest" is wrong twice over, and both
  // were found by running it rather than by reading the schema:
  //
  //   • `Message.senderId → User` has NO cascade — a message keeps its sender —
  //     and the seeder writes trainer→client messages. P2003.
  //   • `ClientProfile.trainerId → TrainerProfile` is RESTRICT, not Cascade
  //     (unlike its ~150 siblings), so the tenant cannot go while it has
  //     clients, and the cascade from the owner hits that wall too. P2003 again.
  //
  // `resetDemoData` is the existing, proven teardown for exactly this shape —
  // it removes a trainer's client-facing data in the order the foreign keys
  // demand, and sweeps the seeded `@pupmanager.test` client logins on the way
  // out. Reused rather than re-derived: a second hand-written delete order
  // would be a second thing to keep in step with the schema, and it is the
  // ordering that is hard, not the deleting.
  await resetDemoData(prisma, profile.id)
  await prisma.user.delete({ where: { id: profile.userId } })

  // Now sweep the orphaned sample clients: only ones with nothing left anywhere.
  // A real person who happened to be a client of this sandbox is impossible
  // (they were all minted by the seeder), but the check costs one query and
  // means a future change that lets a visitor invite a real address cannot turn
  // this into a delete of somebody's account.
  let clientUsersDeleted = 0
  if (clientUserIds.length > 0) {
    const deleted = await prisma.user.deleteMany({
      where: {
        id: { in: clientUserIds },
        clientProfiles: { none: {} },
        memberships: { none: {} },
        trainerProfile: null,
        // Seeded clients live on @pupmanager.test; anything else is left alone.
        OR: [
          { email: { endsWith: '@pupmanager.test' } },
          { email: { endsWith: DEMO_EMAIL_DOMAIN } },
        ],
      },
    })
    clientUsersDeleted = deleted.count
  }

  // History, not data: the session row stays so the lead's visit is still on
  // record, with its tenant pointers nulled.
  await prisma.demoSession.update({
    where: { id: demoSession.id },
    data: {
      status: 'PURGED',
      purgedAt: new Date(),
      trainerId: null,
      ownerUserId: null,
      entryTokenHash: null,
      entryTokenExpires: null,
    },
  })

  return { trainerId: profile.id, clientUsersDeleted }
}
