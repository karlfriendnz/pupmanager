import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { parseDobInput } from '@/lib/date-of-birth'
import { z } from 'zod'

// Whatever the form on /my-dogs refuses, this route refuses too (AGENTS.md
// bug #3 — "validation in the browser is not validation"). The add form is a
// `required` input and a number field; on their own those are decoration, so
// every rule the client sees is restated here.
//
// `z.object` strips unknown keys, which is the point: a body carrying
// `clientProfileId` or `id` cannot reach Prisma. The owning profile is taken
// from the session via getActiveClient and never from the request.
const schema = z.object({
  // Trimmed BEFORE the length check, so "   " is an empty name, not a 3-char one.
  name: z.string().trim().min(1).max(80),
  breed: z.string().trim().max(80).nullish(),
  // Sane bounds: the heaviest dog on record is ~155 kg. An unbounded Float is
  // how a fat-fingered "705" ends up on a roster.
  weight: z.number().positive().max(200).nullish(),
  // Date-only, as the three date-of-birth selects send it.
  dob: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
})

/**
 * A dog cannot have been born tomorrow, and one born in 1900 is a typo. Both
 * rules — plus "2021-02-31 is not a day" — live in lib/date-of-birth so the
 * three selects on screen and this route can never disagree.
 */
const parseDob = (value: string | null | undefined) => parseDobInput(value)

export async function POST(req: Request) {
  // Tenancy comes from the session + the active-trainer cookie, never from the
  // body. Deliberately NOT gated on `session.user.role === 'CLIENT'`: a trainer
  // is often somebody else's client too (see lib/client-context), and the role
  // check locked those people out of their own dog list. getActiveClient can
  // only ever resolve a profile that belongs to the signed-in user.
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Preview mode is read-only — a trainer looking through a client's eyes must
  // not create records in that client's name.
  if (active.isPreview) return NextResponse.json({ error: 'Not available in preview' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const dob = parseDob(parsed.data.dob)
  if (!dob.ok) return NextResponse.json({ error: 'Enter a real date of birth' }, { status: 400 })

  const dog = await prisma.dog.create({
    data: {
      name: parsed.data.name,
      breed: parsed.data.breed?.trim() || null,
      weight: parsed.data.weight ?? null,
      dob: dob.value,
      clientProfileId: active.clientId,
    },
  })

  // The first dog becomes the household's primary. Without this, dogs added
  // after signup were only ever "additional" ones, so a client could have four
  // dogs and no primary — which is what made their trainer's list say "No dog".
  // Guarded on dogId still being null so a second dog never steals the spot.
  await prisma.clientProfile.updateMany({
    where: { id: active.clientId, dogId: null },
    data: { dogId: dog.id },
  })

  return NextResponse.json(dog, { status: 201 })
}
