import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { createInvoiceForAssignment } from '@/lib/invoicing'

export const runtime = 'nodejs'

/**
 * Raise the missing invoice for one class enrolment.
 *
 * Enrolments made before class invoicing existed (or through a path that
 * skipped it) have no receivable behind them — the roster shows "No invoice"
 * against them. This is the one-click repair, so a trainer doesn't have to
 * hand-build an invoice in Finances to bill someone who's clearly on the list.
 *
 * createInvoiceForAssignment is idempotent, so a double-click is harmless, and
 * it returns null when there's genuinely nothing to bill (a free class).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ runId: string; enrollmentId: string }> },
) {
  const guard = await guardPermission('billing.view')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  const trainerId = session?.user?.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, enrollmentId } = await params
  // Tenant guard: the enrolment must be on THIS company's run — never trust the
  // ids alone, or one business could raise invoices against another's clients.
  const enrolment = await prisma.classEnrollment.findFirst({
    where: { id: enrollmentId, classRunId: runId, classRun: { trainerId } },
    select: { id: true, clientId: true, status: true },
  })
  if (!enrolment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (enrolment.status === 'WITHDRAWN') {
    return NextResponse.json({ error: 'That person has withdrawn — there’s nothing to bill.' }, { status: 409 })
  }

  const invoiceId = await createInvoiceForAssignment({
    trainerId,
    clientId: enrolment.clientId,
    sourceType: 'CLASS_ENROLLMENT',
    classEnrollmentId: enrolment.id,
  })

  if (!invoiceId) {
    return NextResponse.json(
      { error: 'Nothing to invoice — this class has no price set.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true, invoiceId })
}
