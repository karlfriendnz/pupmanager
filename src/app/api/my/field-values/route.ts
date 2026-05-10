import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { z } from 'zod'

const schema = z.object({
  values: z.array(z.object({
    fieldId: z.string(),
    value: z.string(),
    dogId: z.string().nullable().optional(),
  })),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, trainerId: true },
  })
  if (!clientProfile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Verify each fieldId belongs to this client's trainer
  const fieldIds = [...new Set(parsed.data.values.map(v => v.fieldId))]
  const validFields = await prisma.customField.findMany({
    where: { id: { in: fieldIds }, trainerId: clientProfile.trainerId },
    select: { id: true },
  })
  const validIds = new Set(validFields.map(f => f.id))

  // Sequential, not Promise.all — a 10-field intake form would
  // otherwise fan out 20+ simultaneous Prisma queries (findFirst +
  // update/create per value) and blow Supabase's 15-slot session
  // pool, which surfaced as a 500 to the client mid-intake. One
  // value at a time means at most one open connection from this
  // request, plenty fast for the typical handful of fields.
  for (const { fieldId, value, dogId } of parsed.data.values.filter(v => validIds.has(v.fieldId))) {
    const resolvedDogId = dogId ?? null
    const existing = await prisma.customFieldValue.findFirst({
      where: { fieldId, clientId: clientProfile.id, dogId: resolvedDogId },
    })
    if (existing) {
      await prisma.customFieldValue.update({ where: { id: existing.id }, data: { value } })
    } else {
      await prisma.customFieldValue.create({
        data: { fieldId, clientId: clientProfile.id, dogId: resolvedDogId, value },
      })
    }
  }

  await safeEvaluate(clientProfile.id)

  return NextResponse.json({ ok: true })
}
