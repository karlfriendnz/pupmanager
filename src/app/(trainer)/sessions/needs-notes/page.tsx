import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ListTodo, FileText, DollarSign } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { NeedsNotesList, type TodoRow } from './needs-notes-list'
import { formatMoney } from '@/lib/money'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'To do' }

// Statuses that count as "notes handled" — the trainer has written the notes
// (form response) OR explicitly marked the session complete/commented/invoiced.
// A session in any of these no longer needs notes, so it only stays on the page
// while it still needs an invoice.
const DONE_STATUSES = ['COMMENTED', 'COMPLETED', 'INVOICED'] as const

// Past sessions that still need either a write-up OR an invoice. Once both
// are recorded the row drops off automatically. "Needs notes" now also clears
// when the session is marked complete (status), not just when a form response
// exists.
async function loadPendingSessions(trainerId: string) {
  const now = new Date()
  return prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { lt: now },
      clientId: { not: null },
      OR: [
        // Still needs notes: no write-up AND not marked complete.
        { AND: [{ formResponses: { none: {} } }, { status: { notIn: [...DONE_STATUSES] } }] },
        // Still needs an invoice.
        { invoicedAt: null },
      ],
    },
    orderBy: { scheduledAt: 'asc' },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      durationMins: true,
      status: true,
      invoicedAt: true,
      _count: { select: { formResponses: true } },
      client: { select: { user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          primaryFor: { take: 1, select: { user: { select: { name: true, email: true } } } },
        },
      },
      clientPackage: {
        select: { package: { select: { priceCents: true, sessionCount: true } } },
      },
    },
  })
}

function sessionValueCents(s: { clientPackage: { package: { priceCents: number | null; sessionCount: number } | null } | null }): number | null {
  const pkg = s.clientPackage?.package
  if (!pkg?.priceCents || !pkg.sessionCount || pkg.sessionCount <= 0) return null
  return Math.round(pkg.priceCents / pkg.sessionCount)
}

export default async function SessionsTodoPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { payoutCurrency: true },
  })
  const currency = profile?.payoutCurrency ?? 'nzd'

  const sessions = await loadPendingSessions(trainerId)
  const needsNotesCount = sessions.filter(s => s._count.formResponses === 0 && !(DONE_STATUSES as readonly string[]).includes(s.status)).length
  const needsInvoiceCount = sessions.filter(s => s.invoicedAt == null).length
  const totalInvoiceCents = sessions.reduce((sum, s) => {
    if (s.invoicedAt != null) return sum
    const v = sessionValueCents(s)
    return v != null ? sum + v : sum
  }, 0)

  const rows: TodoRow[] = sessions.map(s => {
    const clientUser = s.client?.user ?? s.dog?.primaryFor[0]?.user
    return {
      id: s.id,
      title: s.title,
      scheduledAt: s.scheduledAt.toISOString(),
      needsNotes: s._count.formResponses === 0 && !(DONE_STATUSES as readonly string[]).includes(s.status),
      invoiced: s.invoicedAt != null,
      clientName: clientUser ? (clientUser.name ?? clientUser.email) : null,
      dogName: s.dog?.name ?? null,
      valueCents: sessionValueCents(s),
    }
  })

  return (
    <>
      <PageHeader
        title="Sessions to wrap up"
        back={{ href: '/dashboard', label: 'Back to dashboard' }}
        actions={<ListTodo className="h-5 w-5 text-amber-500" />}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">

        <div className="mb-6">
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-500 mt-1">
              You&apos;re all caught up — every past session has notes recorded and is invoiced.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white border border-amber-100 p-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-slate-900 leading-none tabular-nums">{needsNotesCount}</p>
                  <p className="text-xs text-slate-500 mt-1">need notes</p>
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-rose-100 p-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-600 text-white">
                  <DollarSign className="h-5 w-5" strokeWidth={3} />
                </span>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-slate-900 leading-none tabular-nums">
                    {totalInvoiceCents > 0 ? formatMoney(totalInvoiceCents, currency) : needsInvoiceCount}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {needsInvoiceCount} session{needsInvoiceCount === 1 ? '' : 's'} to invoice
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-slate-200 p-10 text-center">
            <ListTodo className="h-8 w-8 mx-auto text-slate-300" />
            <p className="text-sm font-medium text-slate-600 mt-3">All caught up</p>
            <p className="text-xs text-slate-400 mt-1">Past sessions only show here while notes or invoicing are pending.</p>
          </div>
        ) : (
          <NeedsNotesList rows={rows} currency={currency} />
        )}
      </div>
    </>
  )
}
