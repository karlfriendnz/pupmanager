import type { Prisma } from '@/generated/prisma'

// ── Find-or-join: the single source of truth for "a person fills something in
// with their email and lands as a client of this trainer" ──────────────────
//
// Identity is the User (email is @unique = the login key + person identity). A
// person can be a client of MANY trainers — ClientProfile is keyed by the
// (userId, trainerId) pair (see @@unique([userId, trainerId])).
//
// The rule this enforces everywhere a client is created from a REAL email:
//   • Same email → REUSE the existing User. Never make a second person.
//   • Already a client of THIS trainer → JOIN: add the new dog(s) to the
//     existing profile, never spawn a duplicate ClientProfile, never error.
//   • A client of a DIFFERENT trainer (or not a client yet) → create a fresh
//     ClientProfile for (user, thisTrainer); the User is shared.
//
// IMPORTANT — placeholder emails are NOT identities. The
// noemail-<rand>@no-email.pupmanager.app scheme (src/app/api/clients/route.ts)
// is random per-create and must NEVER reach this helper: deduping on it would
// merge unrelated no-email contacts into one person. Callers gate on a real
// email before calling findOrJoinClient.

type TxClient = Prisma.TransactionClient

export interface DogInput {
  name: string
  breed?: string | null
  weight?: number | null
  dob?: Date | null
  notes?: string | null
}

export interface FindOrJoinClientInput {
  email: string
  trainerId: string
  name: string
  phone?: string | null
  address?: {
    line?: string | null
    lat?: number | null
    lng?: number | null
    placeId?: string | null
  } | null
  dogs?: DogInput[]
  /** Profile status when a NEW profile is created (ignored on a join). */
  status?: string
  /** Set invitedAt on a NEW profile (ignored on a join). */
  invitedAt?: Date | null
}

export interface FindOrJoinClientResult {
  clientProfileId: string
  userId: string
  /** True when an existing (userId, trainerId) profile was reused. */
  joined: boolean
  /** True when a brand-new User row was created for this email. */
  createdUser: boolean
  /** Ids of the Dog rows created by THIS call (never includes pre-existing dogs). */
  createdDogIds: string[]
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002'
}

/**
 * Find-or-join a client by REAL email within `tx`. See the file header for the
 * semantics. `tx` is the caller's transaction client so this composes inside an
 * existing $transaction; pass `prisma` directly if you have no surrounding txn.
 *
 * Concurrency: the User is created via `upsert` (the unique-email race resolves
 * to a reuse, never a P2002). The profile is found-then-created with a P2002
 * catch that re-reads the winner of a concurrent insert, so two simultaneous
 * submissions for the same (user, trainer) converge on one profile.
 */
export async function findOrJoinClient(
  tx: TxClient,
  input: FindOrJoinClientInput,
): Promise<FindOrJoinClientResult> {
  const email = input.email.trim()
  const name = input.name.trim() || 'New contact'

  // 1. Reuse the person if the email already exists; otherwise create them.
  //    upsert is concurrency-safe on the unique email (a racing insert resolves
  //    to the existing row instead of throwing). We never clobber an existing
  //    User's name/role — only newly-created users get the supplied name.
  const before = await tx.user.findUnique({ where: { email }, select: { id: true } })
  const user = await tx.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role: 'CLIENT' },
    select: { id: true },
  })
  const createdUser = !before

  // 2. Find-or-create the ClientProfile for (user, trainer).
  const existingProfile = await tx.clientProfile.findUnique({
    where: { userId_trainerId: { userId: user.id, trainerId: input.trainerId } },
    select: { id: true, dogId: true, phone: true, addressLine: true },
  })

  const dogInputs = (input.dogs ?? []).filter(d => d.name?.trim())

  if (existingProfile) {
    // ── JOIN: add the new dog(s); never remove existing ones; only backfill
    //    contact fields that are currently null (never clobber). ──
    return joinExisting(tx, existingProfile, input, dogInputs, user.id)
  }

  // ── No profile yet for this trainer: create one (sharing the User). ──
  try {
    return await createProfile(tx, user.id, input, dogInputs, createdUser)
  } catch (err) {
    // Lost a race to a concurrent insert of the same (user, trainer) profile:
    // re-read the winner and JOIN onto it instead of failing.
    if (isUniqueViolation(err)) {
      const winner = await tx.clientProfile.findUnique({
        where: { userId_trainerId: { userId: user.id, trainerId: input.trainerId } },
        select: { id: true, dogId: true, phone: true, addressLine: true },
      })
      if (winner) return joinExisting(tx, winner, input, dogInputs, user.id)
    }
    throw err
  }
}

async function createDogs(tx: TxClient, dogs: DogInput[], clientProfileId?: string): Promise<string[]> {
  const created = await Promise.all(
    dogs.map(d =>
      tx.dog.create({
        data: {
          name: d.name.trim(),
          breed: d.breed?.trim() || null,
          weight: d.weight ?? null,
          dob: d.dob ?? null,
          notes: d.notes?.trim() || null,
          ...(clientProfileId ? { clientProfileId } : {}),
        },
        select: { id: true },
      }),
    ),
  )
  return created.map(d => d.id)
}

async function createProfile(
  tx: TxClient,
  userId: string,
  input: FindOrJoinClientInput,
  dogInputs: DogInput[],
  createdUser: boolean,
): Promise<FindOrJoinClientResult> {
  // Dogs first so the first one can be set as the profile's primary dog.
  const dogIds = await createDogs(tx, dogInputs)
  const profile = await tx.clientProfile.create({
    data: {
      userId,
      trainerId: input.trainerId,
      status: input.status ?? 'ACTIVE',
      phone: input.phone?.trim() || null,
      addressLine: input.address?.line?.trim() || null,
      addressLat: input.address?.lat ?? null,
      addressLng: input.address?.lng ?? null,
      addressPlaceId: input.address?.placeId ?? null,
      dogId: dogIds[0] ?? null,
      invitedAt: input.invitedAt ?? null,
      // Remaining dogs attach via the additional-dogs relation.
      dogs: dogIds.length > 1 ? { connect: dogIds.slice(1).map(id => ({ id })) } : undefined,
    },
    select: { id: true },
  })
  return { clientProfileId: profile.id, userId, joined: false, createdUser, createdDogIds: dogIds }
}

async function joinExisting(
  tx: TxClient,
  profile: { id: string; dogId: string | null; phone: string | null; addressLine: string | null },
  input: FindOrJoinClientInput,
  dogInputs: DogInput[],
  userId: string,
): Promise<FindOrJoinClientResult> {
  // New dog(s) attach to the existing profile. The first becomes the primary
  // dog ONLY if the profile has none yet; we never displace an existing primary
  // or remove existing dogs.
  const dogIds = await createDogs(tx, dogInputs, profile.id)

  const setPrimary = profile.dogId == null && dogIds.length > 0
  // Backfill contact fields ONLY where currently null — never clobber.
  const backfillPhone = profile.phone == null && !!input.phone?.trim()
  const backfillAddress = profile.addressLine == null && !!input.address?.line?.trim()

  const data: Prisma.ClientProfileUpdateInput = {}
  if (setPrimary) data.dog = { connect: { id: dogIds[0] } }
  if (backfillPhone) data.phone = input.phone!.trim()
  if (backfillAddress) {
    data.addressLine = input.address!.line!.trim()
    data.addressLat = input.address!.lat ?? null
    data.addressLng = input.address!.lng ?? null
    data.addressPlaceId = input.address!.placeId ?? null
  }

  if (Object.keys(data).length > 0) {
    await tx.clientProfile.update({ where: { id: profile.id }, data })
  }

  return { clientProfileId: profile.id, userId, joined: true, createdUser: false, createdDogIds: dogIds }
}
