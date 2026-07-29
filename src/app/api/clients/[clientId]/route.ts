import { NextResponse } from 'next/server'
import { guardPermission, ownsATrainerAccount } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { extraClientDogs } from '@/lib/dogs'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1).optional(),
  // Trainer-editable email. Trimmed + lowercased before the unique
  // check so we can't end up with `Foo@bar.com` and `foo@bar.com`
  // colliding case-insensitively at the auth layer.
  email: z.string().email().transform(s => s.trim().toLowerCase()).optional(),
  // Contact phone, stored on ClientProfile.phone. Empty string clears.
  phone: z.string().trim().max(40).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  // Private trainer-facing notes about the client. Empty string clears.
  notes: z.string().max(20000).nullable().optional(),
  // The trainer (TrainerMembership) this client is assigned to. null unassigns.
  assignedMembershipId: z.string().nullable().optional(),
  dog: z.object({
    name: z.string().min(1),
    breed: z.string().optional().nullable(),
    weight: z.number().positive().optional().nullable(),
    dob: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }).optional().nullable(),
})

export async function DELETE(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  // Deleting a client hard-deletes their User + dogs + history — gate on the
  // clients.edit capability (respects a per-member override, and re-validates
  // membership so a removed member can't delete).
  const guard = await guardPermission('clients.edit')
  if (guard instanceof NextResponse) return guard
  const { clientId } = await params
  const access = await getClientAccess(clientId, guard.userId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Only the primary trainer can delete
  if (access.client.trainerId !== access.trainerId) return NextResponse.json({ error: 'Only the primary trainer can delete a client' }, { status: 403 })

  // Two relations into ClientProfile have no onDelete cascade and would
  // otherwise abort the user-cascade delete:
  //   • Dog.clientProfileId → ClientProfile  (additional household dogs)
  //   • ClientProfile.dogId → Dog            (primary dog)
  // We detach the additional dogs first so the cascade succeeds, then
  // delete the User (which cascades through ClientProfile + tasks +
  // packages + shares + ...), and finally drop the dog rows
  // themselves so a deleted client doesn't leave orphan pets behind.
  // TrainingSession.clientId is SetNull on the schema, so past sessions
  // stay on the calendar as un-attributed history — that's intentional.
  const profile = await prisma.clientProfile.findUnique({
    where: { id: access.client.id },
    select: {
      userId: true,
      dogId: true,
      dogs: { select: { id: true } },
    },
  })
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The primary dog can also appear on the household list — the same Dog row
  // down two relations — so dedupe before we act on the ids.
  const additionalDogIds = extraClientDogs(profile.dogId, profile.dogs).map(d => d.id)
  const dogIdsToDelete = [
    ...(profile.dogId ? [profile.dogId] : []),
    ...additionalDogIds,
  ]

  // One person can be a client of SEVERAL trainers (ClientProfile is keyed on
  // (userId, trainerId)). Deleting the User would take their relationship with
  // every other trainer down too, so that only happens when this was their last
  // one; otherwise we remove just this trainer's profile and leave the person be.
  const otherProfiles = await prisma.clientProfile.count({
    where: { userId: profile.userId, id: { not: access.client.id } },
  })

  try {
    await prisma.$transaction(async tx => {
      if (additionalDogIds.length > 0) {
        await tx.dog.updateMany({
          where: { id: { in: additionalDogIds } },
          data: { clientProfileId: null },
        })
      }
      // Message.senderId is RESTRICT, so any client who has EVER sent a message
      // blocked the delete with a bare 500 ("Could not delete this client").
      // Their messages have to go explicitly first — the clientId side cascades,
      // but the sender side does not.
      await tx.message.deleteMany({
        where: otherProfiles > 0
          ? { clientId: access.client.id }
          : { OR: [{ clientId: access.client.id }, { senderId: profile.userId }] },
      })
      if (otherProfiles > 0) {
        await tx.clientProfile.delete({ where: { id: access.client.id } })
      } else {
        await tx.user.delete({ where: { id: profile.userId } })
      }
      if (dogIdsToDelete.length > 0) {
        await tx.dog.deleteMany({ where: { id: { in: dogIdsToDelete } } })
      }
    })
  } catch (err) {
    console.error('[clients DELETE] failed', { clientId, err })
    return NextResponse.json(
      { error: 'Could not delete this client. Check server logs.' },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const guard = await guardPermission('clients.edit')
  if (guard instanceof NextResponse) return guard

  const { clientId } = await params
  const access = await getClientAccess(clientId, guard.userId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, email, phone, status, notes, dog, assignedMembershipId } = parsed.data
  const { client } = access

  if (name !== undefined) {
    // The name lives on the shared User row — the SAME row that person signs in
    // with. When that person also runs a business on PupManager (they're a
    // client of another trainer, or of their own company because a booking was
    // taken against their own email), writing it here renames THEIR account:
    // their Settings → "Your name", and the sender name on every email their
    // business sends. One trainer's outbound mail went out signed with a
    // client's name that way.
    //
    // So a client edit may only set the name of a person who has no trainer
    // account of their own. Their own name is theirs to change, in their own
    // Settings.
    //
    // This asked only about TrainerMembership, which every account created
    // BEFORE the team feature lacks — getTrainerContext calls them "legacy
    // owners" and infers the role from the TrainerProfile instead. So the guard
    // held for new accounts and missed the oldest ones, and a real business had
    // its name replaced with a client's: every email it sent afterwards went out
    // signed with that client's name, and its own staff row read as them.
    // ownsATrainerAccount asks both questions.
    if (await ownsATrainerAccount(client.userId)) {
      return NextResponse.json(
        { error: 'This person has their own PupManager account, so their name is theirs to change — everything else here is yours to edit.' },
        { status: 409 },
      )
    }
    await prisma.user.update({ where: { id: client.userId }, data: { name } })
  }

  if (phone !== undefined) {
    await prisma.clientProfile.update({
      where: { id: client.id },
      data: { phone: phone?.trim() || null },
    })
  }

  if (notes !== undefined) {
    await prisma.clientProfile.update({
      where: { id: client.id },
      data: { notes: notes?.trim() || null },
    })
  }

  if (email !== undefined) {
    // Only the primary trainer can change the client's email — that's
    // the credential the client uses to log in, and a co-manager
    // shouldn't be able to lock the primary out of their own account.
    if (client.trainerId !== access.trainerId) {
      return NextResponse.json(
        { error: "Only the client's primary trainer can change their email." },
        { status: 403 },
      )
    }
    // Same shared-row problem as the name above, and worse: email IS the login.
    // Rewriting it on someone who runs their own business would move their sign-in
    // to an address they don't control and clear their verification stamp with it.
    if (await ownsATrainerAccount(client.userId)) {
      return NextResponse.json(
        { error: 'This person signs in to their own PupManager account with that email, so it’s theirs to change — everything else here is yours to edit.' },
        { status: 409 },
      )
    }
    // No-op when the email matches what's already on file (case-fold
    // already normalised by the schema transform). Avoids a needless
    // emailVerified reset.
    const currentUser = await prisma.user.findUnique({
      where: { id: client.userId },
      select: { email: true },
    })
    if (currentUser && currentUser.email?.toLowerCase() !== email) {
      try {
        await prisma.user.update({
          where: { id: client.userId },
          data: {
            email,
            // Wipe the verification stamp — the new address hasn't
            // been confirmed yet. The trainer can hit "Re-invite"
            // afterwards to ship a fresh link.
            emailVerified: null,
          },
        })
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          return NextResponse.json(
            { error: 'That email is already used by another account.' },
            { status: 409 },
          )
        }
        throw err
      }
    }
  }

  if (status !== undefined) {
    await prisma.clientProfile.update({ where: { id: client.id }, data: { status } })
  }

  if (assignedMembershipId !== undefined) {
    // Validate the membership belongs to the business that owns this client.
    if (assignedMembershipId) {
      const member = await prisma.trainerMembership.findFirst({
        where: { id: assignedMembershipId, companyId: client.trainerId },
        select: { id: true },
      })
      if (!member) return NextResponse.json({ error: 'Team member not found in this business' }, { status: 400 })
    }
    await prisma.clientProfile.update({
      where: { id: client.id },
      data: { assignedMembershipId: assignedMembershipId || null },
    })
  }

  if (dog !== undefined) {
    if (client.dogId) {
      await prisma.dog.update({
        where: { id: client.dogId },
        data: {
          name: dog!.name,
          breed: dog!.breed ?? null,
          weight: dog!.weight ?? null,
          dob: dog!.dob ? new Date(dog!.dob) : null,
          notes: dog!.notes ?? null,
        },
      })
    } else if (dog) {
      const newDog = await prisma.dog.create({
        data: {
          name: dog.name,
          breed: dog.breed ?? null,
          weight: dog.weight ?? null,
          dob: dog.dob ? new Date(dog.dob) : null,
          notes: dog.notes ?? null,
        },
      })
      await prisma.clientProfile.update({ where: { id: client.id }, data: { dogId: newDog.id } })
    }
  }

  return NextResponse.json({ ok: true })
}
