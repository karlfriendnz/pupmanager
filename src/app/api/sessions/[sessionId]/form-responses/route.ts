import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId } = await params

  // Verify trainer owns the session and pull the package's default form id so
  // we can lazily auto-attach it when no responses exist yet.
  const owns = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId, ...accessibleSessionWhere(ctx) },
    select: {
      id: true,
      clientPackage: { select: { package: { select: { defaultSessionFormId: true } } } },
    },
  })
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let responses = await prisma.sessionFormResponse.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    include: {
      form: { select: { id: true, name: true, questions: true, introText: true, closingText: true } },
    },
  })

  // Lazy auto-attach: first time a package-linked session is opened with no
  // responses, materialise the package's default form. Subsequent opens skip
  // because there's now at least one response.
  const defaultFormId = owns.clientPackage?.package?.defaultSessionFormId
  if (responses.length === 0 && defaultFormId) {
    try {
      await prisma.sessionFormResponse.create({
        data: { sessionId, formId: defaultFormId, answers: {}, imagesByQuestion: {} },
      })
      responses = await prisma.sessionFormResponse.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        include: {
          form: { select: { id: true, name: true, questions: true, introText: true, closingText: true } },
        },
      })
    } catch {
      // Race or stale form id — fall through with whatever we have.
    }
  }

  return NextResponse.json(responses)
}
