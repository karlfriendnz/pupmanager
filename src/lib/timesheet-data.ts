import { prisma } from '@/lib/prisma'
import type { TimesheetPdfData } from '@/lib/timesheet-pdf'

// Loads a timesheet (ownership-scoped) plus everything the PDF/email needs.
// Returns null if the timesheet doesn't belong to (companyId, userId).
export async function loadTimesheetForExport(id: string, companyId: string, userId: string): Promise<
  | null
  | {
      status: string
      recipientEmail: string | null
      sentAt: Date | null
      ownerEmail: string | null
      data: TimesheetPdfData
    }
> {
  const sheet = await prisma.timesheet.findFirst({
    where: { id, companyId, userId },
    include: {
      entries: {
        orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { client: { select: { user: { select: { name: true } } } } },
      },
    },
  })
  if (!sheet) return null

  const [company, user] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: companyId },
      select: { businessName: true, payoutCurrency: true, user: { select: { email: true } } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
  ])

  return {
    status: sheet.status,
    recipientEmail: sheet.recipientEmail,
    sentAt: sheet.sentAt,
    ownerEmail: company?.user?.email ?? null,
    data: {
      businessName: company?.businessName ?? 'PupManager',
      staffName: user?.name ?? user?.email ?? 'Staff member',
      weekStart: sheet.weekStart,
      title: sheet.title,
      notes: sheet.notes,
      currency: company?.payoutCurrency ?? 'nzd',
      finalisedAt: sheet.finalisedAt,
      entries: sheet.entries.map(e => ({
        date: e.date,
        task: e.task,
        minutes: e.minutes,
        rateName: e.rateName,
        amountCents: e.amountCents,
        clientName: e.client?.user?.name ?? null,
        category: e.category,
      })),
    },
  }
}

// Filename like "Timesheet-2026-06-22.pdf"
export function timesheetPdfFilename(weekStart: Date | string): string {
  const d = new Date(weekStart)
  const iso = d.toISOString().slice(0, 10)
  return `Timesheet-${iso}.pdf`
}
