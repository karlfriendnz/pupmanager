import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'
import { FilePen } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { DraftNotesList, type DraftRow } from './draft-notes-list'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Draft notes' }

// Every saved-but-unsent note for this trainer: 1:1 session write-ups
// (SessionFormResponse with no sentAt) plus group-class per-attendee reports
// (SessionAttendance with a report but no reportSentAt). Sending one stamps the
// sent marker and notifies the client.
async function loadDrafts(trainerId: string): Promise<DraftRow[]> {
  const [oneToOne, classRows] = await Promise.all([
    prisma.sessionFormResponse.findMany({
      where: { sentAt: null, session: { trainerId } },
      orderBy: { session: { scheduledAt: 'asc' } },
      select: {
        id: true,
        sessionId: true,
        session: {
          select: {
            title: true,
            scheduledAt: true,
            dog: { select: { name: true } },
            client: { select: { user: { select: { name: true, email: true } } } },
          },
        },
      },
    }),
    prisma.sessionAttendance.findMany({
      where: {
        reportSentAt: null,
        report: { not: Prisma.DbNull },
        session: { classRun: { trainerId } },
      },
      orderBy: { session: { scheduledAt: 'asc' } },
      select: {
        id: true,
        sessionId: true,
        session: { select: { title: true, scheduledAt: true } },
        enrollment: {
          select: {
            dog: { select: { name: true } },
            classRun: { select: { name: true } },
            client: { select: { user: { select: { name: true, email: true } } } },
          },
        },
      },
    }),
  ])

  const rows: DraftRow[] = [
    ...oneToOne.map((r): DraftRow => ({
      kind: 'one_to_one',
      id: r.id,
      sessionId: r.sessionId,
      title: r.session.title,
      scheduledAt: r.session.scheduledAt.toISOString(),
      clientName: r.session.client?.user
        ? r.session.client.user.name ?? r.session.client.user.email
        : null,
      dogName: r.session.dog?.name ?? null,
      isClass: false,
    })),
    ...classRows.map((a): DraftRow => ({
      kind: 'class',
      id: a.id,
      sessionId: a.sessionId,
      title: a.enrollment.classRun?.name ?? a.session.title,
      scheduledAt: a.session.scheduledAt.toISOString(),
      clientName: a.enrollment.client?.user
        ? a.enrollment.client.user.name ?? a.enrollment.client.user.email
        : null,
      dogName: a.enrollment.dog?.name ?? null,
      isClass: true,
    })),
  ]

  // Oldest sessions first so the longest-waiting recaps surface at the top.
  rows.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  return rows
}

export default async function DraftNotesPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const rows = await loadDrafts(trainerId)

  return (
    <>
      <PageHeader
        title="Draft notes"
        back={{ href: '/schedule', label: 'Schedule' }}
        actions={<FilePen className="h-5 w-5 text-teal-500" />}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
        <p className="text-sm text-slate-500 mb-6">
          Notes you&apos;ve saved but not sent yet. The client can&apos;t see a recap until you send it.
          Send them one at a time, or select several and send together.
        </p>

        {rows.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-slate-200 p-10 text-center">
            <FilePen className="h-8 w-8 mx-auto text-slate-300" />
            <p className="text-sm font-medium text-slate-600 mt-3">No drafts waiting</p>
            <p className="text-xs text-slate-400 mt-1">Saved notes appear here until you send them to the client.</p>
          </div>
        ) : (
          <DraftNotesList rows={rows} />
        )}
      </div>
    </>
  )
}
