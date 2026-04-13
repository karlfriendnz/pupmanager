import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ScheduleView } from './schedule-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Schedule' }

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, googleCalendarConnected: true },
  })
  if (!trainerProfile) redirect('/onboarding')

  const today = new Date().toISOString().split('T')[0]
  const selectedDate = searchParams.date ?? today

  const dayStart = new Date(selectedDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(selectedDate)
  dayEnd.setHours(23, 59, 59, 999)

  const sessions = await prisma.trainingSession.findMany({
    where: {
      trainerId: trainerProfile.id,
      scheduledAt: { gte: dayStart, lte: dayEnd },
    },
    include: {
      dog: { select: { name: true, clientProfiles: { take: 1, select: { user: { select: { name: true, email: true } } } } } },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  return (
    <ScheduleView
      sessions={sessions}
      selectedDate={selectedDate}
      today={today}
      googleCalendarConnected={trainerProfile.googleCalendarConnected}
    />
  )
}
