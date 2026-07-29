import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

// ── Dog-owner self-registration ──────────────────────────────────────────────
//
// Until now every CLIENT user was created BY a trainer (src/app/api/clients,
// findOrJoinClient). A dog owner told "we use PupManager, go sign up" landed on
// /signup or /register and got a TRAINER account on a free trial — six such
// accounts exist in production with no business name.
//
// This is the missing half. It creates the person's login only:
//
//     User (role CLIENT) + credentials Account (bcrypt password)
//
// It deliberately does NOT create a ClientProfile. A ClientProfile requires a
// trainerId, and a client list is the trainer's business record — a public link
// must never write into it. Instead we raise an Enquiry (source SELF_SIGNUP)
// against the chosen trainer, which the trainer accepts from their existing
// enquiries surface. Accepting runs acceptEnquiry -> findOrJoinClient, which
// reuses this very User by email and attaches the profile. One approval
// mechanism, not two.
//
// Password hashing / Account shape mirror /api/auth/signup exactly: the
// bcrypt(12) digest is stored as `Account.providerAccountId` for
// provider="credentials", which is what lib/auth.ts authorize() compares
// against.

/** Where a self-signup enquiry came from, on Enquiry.source. */
export const ENQUIRY_SOURCE_SELF_SIGNUP = 'SELF_SIGNUP'

export class ClientSignupError extends Error {
  constructor(
    public code: 'EMAIL_TAKEN' | 'TRAINER_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'ClientSignupError'
  }
}

export interface ClientSignupInput {
  name: string
  email: string
  password: string
  phone?: string | null
  /** Their dog's name, if they gave one — carried onto the profile on accept. */
  dogName?: string | null
  /** Free-text note for the trainer. */
  message?: string | null
  /**
   * The trainer they're asking to join. Optional: someone who signed up from
   * the app without a trainer's link gets an account with no request yet and
   * is sent to /find-trainer, which tells them to get that link. There is no
   * trainer directory to pick from — see the note on that screen.
   */
  trainerId?: string | null
}

export interface ClientSignupResult {
  userId: string
  /** The join request raised, when a trainer was named. */
  enquiryId: string | null
}

/**
 * Create a dog owner's PupManager login, plus (optionally) a request to join a
 * trainer. Throws ClientSignupError for the two states the caller must render
 * differently: the email is already in use, or the trainer id is bogus.
 */
export async function createClientAccount(input: ClientSignupInput): Promise<ClientSignupResult> {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()

  // One identity per email — the same rule findOrJoinClient enforces. We never
  // attach a password to an EXISTING user here: a client their trainer already
  // added has a User row with no credentials, and letting anyone who knows that
  // address set its password would be account takeover. They sign in (or use
  // the email-me-a-link button) instead, which the caller's 409 copy says.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new ClientSignupError(
      'EMAIL_TAKEN',
      'There is already a PupManager account for this email. Sign in instead — use “Email me a sign-in link” if you have never set a password.',
    )
  }

  let trainer: { id: string; businessName: string } | null = null
  if (input.trainerId) {
    trainer = await prisma.trainerProfile.findFirst({
      // A deactivated owner's business must not accept new join requests —
      // nobody would ever see them.
      where: { id: input.trainerId, user: { deactivatedAt: null } },
      select: { id: true, businessName: true },
    })
    if (!trainer) throw new ClientSignupError('TRAINER_NOT_FOUND', 'We could not find that trainer.')
  }

  const passwordHash = await bcrypt.hash(input.password, 12)

  return prisma.$transaction(async tx => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        role: 'CLIENT',
        // Left null exactly as it is for every trainer-created client. Login is
        // NOT gated on it for clients (lib/auth.ts only blocks unverified
        // TRAINERs) — the trainer's approval is the real gate here, and gating
        // on it would lock out every client who predates this flow.
        emailVerified: null,
      },
      select: { id: true },
    })

    await tx.account.create({
      data: {
        userId: user.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: passwordHash,
      },
    })

    const enquiryId = trainer
      ? await createJoinRequestIn(tx, {
          trainerId: trainer.id,
          name,
          email,
          phone: input.phone,
          dogName: input.dogName,
          message: input.message,
        })
      : null

    return { userId: user.id, enquiryId }
  })
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

interface JoinRequestInput {
  trainerId: string
  name: string
  email: string
  phone?: string | null
  dogName?: string | null
  message?: string | null
}

async function createJoinRequestIn(tx: TxClient, input: JoinRequestInput): Promise<string> {
  const enquiry = await tx.enquiry.create({
    data: {
      trainerId: input.trainerId,
      // No originating form — this came from the person's own signup.
      formId: null,
      source: ENQUIRY_SOURCE_SELF_SIGNUP,
      name: input.name,
      email: input.email,
      phone: input.phone?.trim() || null,
      dogName: input.dogName?.trim() || null,
      message: input.message?.trim() || null,
    },
    select: { id: true },
  })
  return enquiry.id
}

/**
 * Raise a join request for a dog owner who ALREADY has a login. Idempotent per
 * (user, trainer): a second tap returns the pending request rather than
 * spamming the trainer's list, and a trainer who has already added them is a
 * no-op with `alreadyClient`.
 *
 * NB no screen currently calls this: /find-trainer used to let them search for
 * a business and ask, which is the trainer-directory enumeration hole that was
 * removed. It stays because it is the correct, authenticated way to raise a
 * request for a NAMED trainer, and is still reached via /api/my/join-requests.
 */
export async function requestToJoinTrainer(args: {
  userId: string
  trainerId: string
  message?: string | null
}): Promise<{ enquiryId: string | null; pending: boolean; alreadyClient: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, name: true, email: true },
  })
  if (!user?.email) throw new ClientSignupError('EMAIL_TAKEN', 'Your account has no email address.')

  const trainer = await prisma.trainerProfile.findFirst({
    where: { id: args.trainerId, user: { deactivatedAt: null } },
    select: { id: true },
  })
  if (!trainer) throw new ClientSignupError('TRAINER_NOT_FOUND', 'We could not find that trainer.')

  // Already their client → nothing to approve.
  const profile = await prisma.clientProfile.findUnique({
    where: { userId_trainerId: { userId: user.id, trainerId: trainer.id } },
    select: { id: true },
  })
  if (profile) return { enquiryId: null, pending: false, alreadyClient: true }

  // Already asked and not yet answered → surface the same request again.
  const pending = await prisma.enquiry.findFirst({
    where: { trainerId: trainer.id, email: user.email, status: 'NEW' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (pending) return { enquiryId: pending.id, pending: true, alreadyClient: false }

  const enquiry = await createJoinRequestIn(prisma, {
    trainerId: trainer.id,
    name: user.name?.trim() || user.email,
    email: user.email,
    message: args.message,
  })
  return { enquiryId: enquiry, pending: false, alreadyClient: false }
}

/**
 * What a dog owner with no trainer yet should see on /find-trainer: the
 * requests they have outstanding, so the screen explains itself rather than
 * being a dead end.
 */
export async function getPendingJoinRequests(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user?.email) return []
  const rows = await prisma.enquiry.findMany({
    where: { email: user.email, status: 'NEW' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      trainer: { select: { id: true, businessName: true, logoUrl: true } },
    },
  })
  return rows.map(r => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    trainerId: r.trainer.id,
    businessName: r.trainer.businessName,
    logoUrl: r.trainer.logoUrl,
  }))
}
