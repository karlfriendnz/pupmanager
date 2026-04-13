import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { formId } = await params

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await prisma.intakeForm.findFirst({
    where: { id: formId, trainerId: trainerProfile.id },
  })
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const submissions = await prisma.formSubmission.findMany({
    where: { formId },
    orderBy: { submittedAt: 'desc' },
  })

  return NextResponse.json(submissions)
}
