import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTrainerEmailReport } from '@/lib/onboarding/email-report'

// GET /api/admin/trainers/[trainerId]/onboarding-emails
// Returns the trainer's onboarding/trial email report (received + upcoming) for
// the expandable row on the admin Trainers table. `trainerId` is the User id
// (matches the rest of /api/admin/trainers/*); we resolve the TrainerProfile.
export async function GET(_req: Request, { params }: { params: Promise<{ trainerId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { trainerId } = await params
  const profile = await prisma.trainerProfile.findUnique({
    where: { userId: trainerId },
    select: { id: true },
  })
  if (!profile) {
    return NextResponse.json({ error: 'Trainer not found' }, { status: 404 })
  }

  const report = await getTrainerEmailReport(profile.id)
  return NextResponse.json(report)
}
