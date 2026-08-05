import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { dogBelongsToAnyClient } from '@/lib/dog-access'
import { parseDobInput } from '@/lib/date-of-birth'
import { z } from 'zod'

// Same rules the /my-dogs add form enforces on screen, restated here — the
// browser's `required`/`max` attributes are decoration (AGENTS.md bug #3).
const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  breed: z.string().trim().max(80).nullable().optional(),
  weight: z.number().positive().max(200).nullable().optional(),
  // Date-only ("1970-01-01") — the shape the three date-of-birth selects emit.
  // Null clears it. `parseDobInput` below is the real check.
  dob: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

// All of the signed-in user's client-profile ids. A human can be a client of
// several businesses, so dog ownership must be checked across ALL their
// profiles — resolving a single arbitrary profile (findFirst) both rejects
// legitimate edits and makes the IDOR guard unreliable.
async function myClientIds(userId: string): Promise<string[]> {
  const profiles = await prisma.clientProfile.findMany({ where: { userId }, select: { id: true } })
  return profiles.map(p => p.id)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ dogId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { dogId } = await params
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  if (!(await dogBelongsToAnyClient(dogId, await myClientIds(session.user.id)))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { dob, ...rest } = parsed.data
  let dobValue: Date | null | undefined
  if (dob !== undefined) {
    // One parser, shared with the three date-of-birth selects on screen, so the
    // two ends can't disagree about what a birthday is. It also rejects a date
    // that only LOOKS real — "2021-02-31" rolls over to 3 March in raw
    // `new Date()`, which used to store a different day than was picked.
    const result = parseDobInput(dob)
    if (!result.ok) return NextResponse.json({ error: 'Enter a real date of birth' }, { status: 400 })
    dobValue = result.value
  }

  const dog = await prisma.dog.update({
    where: { id: dogId },
    data: { ...rest, ...(dobValue !== undefined ? { dob: dobValue } : {}) },
  })
  return NextResponse.json(dog)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ dogId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { dogId } = await params
  const clientIds = await myClientIds(session.user.id)
  if (!(await dogBelongsToAnyClient(dogId, clientIds))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // If this was a primary dog for any of the user's profiles, clear the ref.
  await prisma.clientProfile.updateMany({
    where: { id: { in: clientIds }, dogId },
    data: { dogId: null },
  })
  await prisma.dog.delete({ where: { id: dogId } })
  return NextResponse.json({ ok: true })
}
