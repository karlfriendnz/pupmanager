import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { formatDate } from '@/lib/utils'
import { isClassRunPast } from '@/lib/class-runs'
import { DropInsView } from './drop-ins-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Drop-ins' }

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Tue 3:00pm–5:00pm · Sat 9:00am–10:00am" — the shape of the week at a glance,
 *  which is the one thing a drop-in class is really defined by. */
function slotSummary(slots: { day: number; startTime: string; endTime: string }[]): string | null {
  if (slots.length === 0) return null
  const t = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    const period = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
  }
  // Only the first few — a long schedule shouldn't push the rest off the card.
  const shown = slots.slice(0, 3).map(s => `${DAY_SHORT[s.day] ?? ''} ${t(s.startTime)}–${t(s.endTime)}`.trim())
  return shown.join(' · ') + (slots.length > 3 ? ` +${slots.length - 3} more` : '')
}

export default async function DropInsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Drop-ins ride on top of group classes — both add-ons have to be on.
  const [dropinsOn, classesOn] = await Promise.all([
    hasAddon(trainerId, 'dropins'),
    hasAddon(trainerId, 'classes'),
  ])
  if (!dropinsOn || !classesOn) redirect('/settings?tab=addons')

  const now = new Date()

  const [runs, trainer] = await Promise.all([
    prisma.classRun.findMany({
      where: { trainerId, package: { allowDropIn: true } },
      orderBy: { startDate: 'asc' },
      include: {
        package: {
          select: {
            id: true, name: true, description: true, capacity: true, dropInPriceCents: true,
            sessionSlots: { orderBy: { order: 'asc' }, select: { day: true, startTime: true, endTime: true } },
          },
        },
        // Upcoming sessions are what a drop-in can actually be sold into; the
        // last session (in either direction) decides current vs past.
        sessions: { orderBy: { scheduledAt: 'asc' }, select: { id: true, scheduledAt: true, sessionIndex: true } },
        enrollments: { where: { status: 'ENROLLED' }, select: { id: true, type: true } },
      },
    }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { payoutCurrency: true } }),
  ])

  return (
    <DropInsView
      currency={(trainer?.payoutCurrency ?? 'NZD').toUpperCase()}
      runs={runs.map(r => {
        const capacity = r.capacity ?? r.package.capacity ?? null
        const enrolled = r.enrollments.length
        const upcoming = r.sessions.filter(s => s.scheduledAt >= now)
        return {
          id: r.id,
          packageId: r.package.id,
          name: r.name,
          description: r.package.description,
          scheduleNote: r.scheduleNote,
          startLabel: formatDate(r.startDate),
          location: r.location,
          capacity,
          enrolled,
          // A drop-in can only go into a seat that exists.
          spacesLeft: capacity == null ? null : Math.max(0, capacity - enrolled),
          dropInPriceCents: r.package.dropInPriceCents,
          dropInCount: r.enrollments.filter(e => e.type === 'DROP_IN').length,
          slotSummary: slotSummary(r.package.sessionSlots),
          upcoming: upcoming.map(s => ({
            id: s.id,
            index: s.sessionIndex,
            label: formatDate(s.scheduledAt),
          })),
          isPast: isClassRunPast(
            { status: r.status, startDate: r.startDate, lastSessionAt: r.sessions[r.sessions.length - 1]?.scheduledAt },
            now,
          ),
        }
      })}
    />
  )
}
