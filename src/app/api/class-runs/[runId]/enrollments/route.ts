import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { enrollInRun, ClassError } from '@/lib/class-runs'
import { notifyClient } from '@/lib/client-notify'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { resolveRequirePayment } from '@/lib/require-payment'
import { dogBelongsToClient } from '@/lib/dog-access'

// POST /api/class-runs/[runId]/enrollments
// Trainer-assigned enrolment. Capacity / waitlist / drop-in are decided
// server-side inside the transaction (see lib/class-runs.ts).
const schema = z.object({
  clientId: z.string().min(1),
  dogId: z.string().min(1).nullable().optional(),
  type: z.enum(['FULL', 'DROP_IN']).optional(),
  // Whether to tell the client they've been enrolled. Default true.
  notify: z.boolean().optional(),
  // Whether to ask the client to pay now: marks the invoice sent and puts the
  // Pay now button in the enrolment email. Omitted = fall back to the trainer's
  // autoSendInvoices setting, which is what happened before this was a choice.
  sendInvoice: z.boolean().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params

  // Both the run and the client must belong to this trainer.
  const run = await prisma.classRun.findFirst({ where: { id: runId, trainerId }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const client = await prisma.clientProfile.findFirst({
    where: { id: parsed.data.clientId, trainerId },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // The dog (if any) must belong to the client being enrolled — otherwise a
  // trainer could pair a client with another client's dog.
  if (parsed.data.dogId && !(await dogBelongsToClient(parsed.data.dogId, parsed.data.clientId))) {
    return NextResponse.json({ error: 'That dog does not belong to this client.' }, { status: 400 })
  }

  try {
    const result = await enrollInRun({
      classRunId: runId,
      clientId: parsed.data.clientId,
      dogId: parsed.data.dogId ?? null,
      type: parsed.data.type ?? 'FULL',
      source: 'TRAINER',
    })

    // Raise the receivable, exactly as assigning a 1:1 package does. Class
    // enrolments were the one priced thing that never produced an invoice, so
    // there was nothing for the client to pay against and no pay link to send.
    // Idempotent + best-effort; never blocks the enrolment.
    const enrollmentId = (result as { enrollmentId?: string }).enrollmentId ?? null
    let invoiceId: string | null = null
    if (enrollmentId && (result as { status?: string }).status !== 'WAITLISTED') {
      invoiceId = await createInvoiceForAssignment({
        trainerId,
        clientId: parsed.data.clientId,
        sourceType: 'CLASS_ENROLLMENT',
        classEnrollmentId: enrollmentId,
        // The enrolment email below carries the same Pay now link.
        notifyClient: false,
      })
    }

    // Tell the client they're in (skip waitlisted spots + the trainer opt-out).
    if (parsed.data.notify !== false && (result as { status?: string }).status !== 'WAITLISTED') {
      const [runDetail, clientUser, trainer, dog] = await Promise.all([
        prisma.classRun.findUnique({ where: { id: runId }, select: { name: true, requirePayment: true, package: { select: { description: true } }, sessions: { where: { scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: 'asc' }, select: { scheduledAt: true } } } }),
        prisma.clientProfile.findUnique({ where: { id: parsed.data.clientId }, select: { userId: true } }),
        prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { businessName: true, defaultRequirePayment: true, autoSendInvoices: true, user: { select: { name: true, timezone: true } } } }),
        parsed.data.dogId ? prisma.dog.findUnique({ where: { id: parsed.data.dogId }, select: { name: true } }) : Promise.resolve(null),
      ])
      // Ask for payment now, or leave the invoice as a draft to chase later?
      // Defaults to the trainer's own autoSendInvoices setting so behaviour is
      // unchanged for anyone who doesn't touch the new checkbox.
      const sendInvoice = parsed.data.sendInvoice ?? (trainer?.autoSendInvoices ?? false)

      let payToken: string | null = null
      if (invoiceId && runDetail && resolveRequirePayment(runDetail.requirePayment, trainer?.defaultRequirePayment ?? false)) {
        // Keep the invoice's sent state honest: createInvoiceForAssignment
        // stamps sentAt from autoSendInvoices, so an explicit choice here has
        // to override it either way.
        await prisma.invoice
          .update({ where: { id: invoiceId }, data: { sentAt: sendInvoice ? new Date() : null } })
          .catch(() => {})
        if (sendInvoice) {
          payToken = (await prisma.invoice
            .findUnique({ where: { id: invoiceId }, select: { payToken: true } })
            .catch(() => null))?.payToken ?? null
        }
      }

      if (clientUser?.userId && runDetail) {
        // The class happens in the TRAINER's locale — render the times in the
        // trainer's timezone so a 3pm class never shows as UTC "3am".
        const tz = trainer?.user?.timezone ?? 'Pacific/Auckland'
        await notifyClient({
          userId: clientUser.userId,
          trainerId,
          type: 'CLIENT_ADDED_TO_PLAN',
          vars: {
            trainerName: trainer?.user?.name ?? trainer?.businessName ?? 'Your trainer',
            dogName: dog?.name ?? 'your dog',
            planName: runDetail.name,
            detail: `${runDetail.sessions.length} session${runDetail.sessions.length === 1 ? '' : 's'}`,
            // What the class actually is — the run name alone rarely says.
            description: runDetail.package?.description ?? '',
          },
          // Pay-to-book classes get a "Pay now" button straight to the public
          // pay page (no login). Everything else keeps the sessions view.
          link: payToken ? `/pay/${payToken}` : '/my-sessions',
          ctaLabel: payToken ? 'Pay now' : 'View your sessions',
          sessions: runDetail.sessions.map(s => ({ when: s.scheduledAt.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) })),
        })
      }
    }

    return NextResponse.json({ ok: true, ...result }, { status: 201 })
  } catch (err) {
    if (err instanceof ClassError) {
      const status = err.code === 'FULL' || err.code === 'ALREADY_ENROLLED' ? 409 : 400
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    throw err
  }
}
