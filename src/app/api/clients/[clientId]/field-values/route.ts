import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { safeEvaluate } from '@/lib/achievements'
import { z } from 'zod'

const schema = z.object({
  values: z.array(z.object({
    fieldId: z.string(),
    value: z.string(),
    dogId: z.string().nullable().optional(),
  })),
})

export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const values = await prisma.customFieldValue.findMany({ where: { clientId } })
  return NextResponse.json(values)
}

export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Use findFirst + update/create since dogId can be null (upsert breaks with nullable composite key)
  await Promise.all(parsed.data.values.map(async ({ fieldId, value, dogId }) => {
    const resolvedDogId = dogId ?? null
    const existing = await prisma.customFieldValue.findFirst({
      where: { fieldId, clientId, dogId: resolvedDogId },
    })
    if (existing) {
      await prisma.customFieldValue.update({ where: { id: existing.id }, data: { value } })
    } else {
      await prisma.customFieldValue.create({ data: { fieldId, clientId, dogId: resolvedDogId, value } })
    }
  }))

  await safeEvaluate(clientId)

  return NextResponse.json({ ok: true })
}
