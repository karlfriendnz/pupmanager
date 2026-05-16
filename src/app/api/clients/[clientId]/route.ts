import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
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
  dog: z.object({
    name: z.string().min(1),
    breed: z.string().optional().nullable(),
    weight: z.number().positive().optional().nullable(),
    dob: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }).optional().nullable(),
})

export async function DELETE(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Only the primary trainer can delete
  if (access.client.trainerId !== access.trainerId) return NextResponse.json({ error: 'Only the primary trainer can delete a client' }, { status: 403 })

  // Two relations into ClientProfile have no onDelete cascade and would
  // otherwise abort the user-cascade delete:
  //   • Dog.clientProfileId → ClientProfile  (additional household dogs)
  //   • ClientProfile.dogId → Dog            (primary dog)
  // We detach the additional dogs first so the cascade succeeds, then
  // delete the User (which cascades through ClientProfile + tasks +
  // packages + shares + messages + ...), and finally drop the dog rows
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

  const additionalDogIds = profile.dogs.map(d => d.id)
  const dogIdsToDelete = [
    ...(profile.dogId ? [profile.dogId] : []),
    ...additionalDogIds,
  ]

  try {
    await prisma.$transaction(async tx => {
      if (additionalDogIds.length > 0) {
        await tx.dog.updateMany({
          where: { id: { in: additionalDogIds } },
          data: { clientProfileId: null },
        })
      }
      await tx.user.delete({ where: { id: profile.userId } })
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
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, email, phone, status, dog } = parsed.data
  const { client } = access

  if (name !== undefined) {
    await prisma.user.update({ where: { id: client.userId }, data: { name } })
  }

  if (phone !== undefined) {
    await prisma.clientProfile.update({
      where: { id: client.id },
      data: { phone: phone?.trim() || null },
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
