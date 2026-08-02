import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'
import { FilePen } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { DraftNotesList, type DraftRow } from './draft-notes-list'
import { reportHasContent, attendanceReportHasContent } from '@/lib/report-visibility'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Draft notes' }

// What this screen holds NOW.
//
// It used to be every saved-but-unsent note, because every saved note was
// unsent until the trainer came here and pressed Send. Completing a session
// publishes its write-up now (lib/report-visibility), so that list would be a
// list of things that mostly aren't drafts at all.
//
// A draft is therefore exactly what the word means: a write-up on a session the
// trainer has NOT called done. Those are the only notes still sitting private,
// and Send is still the right verb for them — it is the early release, for the
// trainer who wants the client reading tonight's notes before they get round to
// ticking the session off.
//
// Empty responses are excluded too. Attaching a form writes a blank row, and
// this screen has been listing those as drafts you could "send" — you cannot
// send nothing, and the row was noise.
async function loadDrafts(trainerId: string): Promise<DraftRow[]> {
  const [oneToOne, classRows] = await Promise.all([
    prisma.sessionFormResponse.findMany({
      where: { sentAt: null, session: { trainerId, status: 'UPCOMING' } },
      orderBy: { session: { scheduledAt: 'asc' } },
      select: {
        id: true,
        sessionId: true,
        answers: true,
        introMessage: true,
        closingMessage: true,
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
        session: { status: 'UPCOMING', classRun: { trainerId } },
      },
      orderBy: { session: { scheduledAt: 'asc' } },
      select: {
        id: true,
        sessionId: true,
        report: true,
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
    ...oneToOne.filter(reportHasContent).map((r): DraftRow => ({
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
    ...classRows.filter(a => attendanceReportHasContent(a.report)).map((a): DraftRow => ({
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
        // No decorative icon in the actions slot — beside the "+" and search on
        // a phone it reads as a third button that does nothing.
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
        {rows.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-slate-200 p-10 text-center">
            <FilePen className="h-8 w-8 mx-auto text-slate-300" />
            <p className="text-sm font-medium text-slate-600 mt-3">No drafts waiting</p>
            <p className="text-xs text-slate-400 mt-1">
              Marking a session complete shows its notes to the client. Only notes on
              sessions you haven&rsquo;t marked complete wait here.
            </p>
          </div>
        ) : (
          <DraftNotesList rows={rows} />
        )}
      </div>
    </>
  )
}
