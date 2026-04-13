import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ScheduleView } from './schedule-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Schedule' }

function getWeekBounds(dateStr: string): { weekStart: Date; weekEnd: Date } {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const weekStart = new Date(d)
  weekStart.setDate(d.getDate() + diff)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)
  return { weekStart, weekEnd }
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, googleCalendarConnected: true },
  })
  if (!trainerProfile) redirect('/onboarding')

  const today = new Date().toISOString().split('T')[0]
  const sp = await searchParams
  const selectedDate = sp.date ?? today

  const { weekStart, weekEnd } = getWeekBounds(selectedDate)

  const [sessions, availabilitySlots] = await Promise.all([
    prisma.trainingSession.findMany({
      where: {
        trainerId: trainerProfile.id,
        scheduledAt: { gte: weekStart, lte: weekEnd },
      },
      include: {
        dog: {
          select: {
            name: true,
            primaryFor: {
              take: 1,
              select: { id: true, user: { select: { name: true, email: true } } },
            },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    prisma.availabilitySlot.findMany({
      where: { trainerId: trainerProfile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    }),
  ])

  return (
    <ScheduleView
      sessions={sessions.map(s => ({
        ...s,
        scheduledAt: s.scheduledAt.toISOString(),
      }))}
      availabilitySlots={availabilitySlots.map(s => ({
        ...s,
        date: s.date ? s.date.toISOString().split('T')[0] : null,
      }))}
      selectedDate={selectedDate}
      today={today}
      googleCalendarConnected={trainerProfile.googleCalendarConnected}
    />
  )
}
