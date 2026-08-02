import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { formatDate } from '@/lib/utils'
import { isClassRunPast, NON_EVENT_PACKAGE } from '@/lib/class-runs'
import { DropInsView } from './drop-ins-view'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'
import { notYetShowingBadge } from '@/lib/offering-visibility'
import { listOfferingTags } from '@/lib/tags'

export const metadata: Metadata = { title: 'Casual Classes' }

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
  // Casual classes stands on its own (Karl, 2026-07-30). It used to require the
  // group-classes add-on as well, on the reasoning that a drop-in is a single
  // session of a course — but they're different products: a trainer can sell
  // casual sessions without running a single fixed-length course, and this screen
  // loads its own runs (package.allowDropIn) rather than anything the classes
  // feature provides. Coupling them meant switching one off broke the other.
  if (!(await hasAddon(trainerId, 'dropins'))) redirect(addonSettingsHref('dropins'))

  const now = new Date()

  const [runs, trainer, tagIndex] = await Promise.all([
    prisma.classRun.findMany({
      // Puppy schools are drop-in-flagged (each day-part books like a drop-in)
      // but live in their own workspace, so keep them off the drop-ins list.
      // Events are excluded for the same reason: one offering, one list. The
      // packages API won't let a row be both, but the four list queries must
      // agree with runKind() anyway or something appears twice or nowhere.
      where: { trainerId, package: { allowDropIn: true, isPuppySchool: false, ...NON_EVENT_PACKAGE } },
      // Trainer's arranged order first; date breaks ties.
      orderBy: [{ order: 'asc' }, { startDate: 'asc' }],
      include: {
        package: {
          select: {
            id: true, name: true, description: true, capacity: true, dropInPriceCents: true,
            // Whether clients can see this yet — the run inherits it.
            visibleFrom: true,
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
    // The tags live on the PACKAGE behind each run, not on the run itself —
    // one query for the trainer's whole arrangement and everything carrying it.
    listOfferingTags(trainerId),
  ])

  return (
    <DropInsView
      currency={(trainer?.payoutCurrency ?? 'NZD').toUpperCase()}
      tagOrder={tagIndex.order}
      runs={runs.map(r => {
        const capacity = r.capacity ?? r.package.capacity ?? null
        const enrolled = r.enrollments.length
        const upcoming = r.sessions.filter(s => s.scheduledAt >= now)
        return {
          id: r.id,
          packageId: r.package.id,
          name: r.name,
          imageUrl: r.imageUrl,
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
          notYetShowing: notYetShowingBadge(r.package.visibleFrom, now) !== null,
          isPast: isClassRunPast(
            { status: r.status, startDate: r.startDate, lastSessionAt: r.sessions[r.sessions.length - 1]?.scheduledAt },
            now,
          ),
          tags: tagIndex.byPackage[r.package.id] ?? [],
        }
      })}
    />
  )
}
