import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Returns everything the session-form filler needs to render CUSTOM_FIELD
 * questions: the trainer's full CustomField catalog, plus any existing values
 * already set on the session's client / primary dog.
 *
 * Shape:
 * {
 *   clientId: string | null,
 *   primaryDogId: string | null,
 *   customFields: [{ id, label, type, options, appliesTo, currentValue }]
 * }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: {
      clientId: true,
      dogId: true,
      // Fall back to the client's primary dog if the session itself isn't linked
      // to a specific dog — most package-created sessions don't pick one upfront.
      client: { select: { dogId: true } },
    },
  })
  if (!trainingSession) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const clientId = trainingSession.clientId
  const dogId = trainingSession.dogId ?? trainingSession.client?.dogId ?? null

  const fields = await prisma.customField.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
  })

  // Pull the client's existing values in one go, then index for lookup.
  const values = clientId
    ? await prisma.customFieldValue.findMany({
        where: {
          clientId,
          fieldId: { in: fields.map(f => f.id) },
          // OWNER values have dogId=null; DOG values match the resolved dog.
          OR: [
            { dogId: null },
            ...(dogId ? [{ dogId }] : []),
          ],
        },
        select: { fieldId: true, dogId: true, value: true },
      })
    : []

  const byKey = new Map<string, string>()
  for (const v of values) {
    byKey.set(`${v.fieldId}::${v.dogId ?? ''}`, v.value)
  }

  return NextResponse.json({
    clientId,
    primaryDogId: dogId,
    customFields: fields.map(f => {
      const key = `${f.id}::${f.appliesTo === 'DOG' ? (dogId ?? '') : ''}`
      return {
        id: f.id,
        label: f.label,
        type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
        options: Array.isArray(f.options) ? f.options as string[] : [],
        appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
        currentValue: byKey.get(key) ?? '',
      }
    }),
  })
}
