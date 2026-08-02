import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { notifyEnquiryTrainer } from '@/lib/notify-enquiry-trainer'
import { effectiveCapacity, seatsRemaining, PUBLIC_CLASS_ENROLLMENT_ENABLED } from '@/lib/class-runs'
import { offeringVisibleWhere } from '@/lib/offering-visibility'

// Public (unauthenticated) class self-enrolment, reached via an embed
// form. Mirrors the form-submit pattern: we never create an account or
// touch billing here — a prospective client requests a class, an Enquiry
// is created tagged with the run, and the trainer accepts (and enrols)
// from their inbox. Paid classes therefore park on the trainer's accept
// step until Stripe go-live wires checkout into the accept flow.

async function trainerForForm(formId: string) {
  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
    select: { id: true, trainerId: true },
  })
  return form
}

// GET — open, publicly-enrollable runs for this form's trainer + seats.
export async function GET(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  if (!PUBLIC_CLASS_ENROLLMENT_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { formId } = await params
  const form = await trainerForForm(formId)
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const runs = await prisma.classRun.findMany({
    where: {
      trainerId: form.trainerId,
      status: 'SCHEDULED',
      package: { isGroup: true, publicEnrollment: true, ...offeringVisibleWhere() },
    },
    orderBy: { startDate: 'asc' },
    include: {
      package: { select: { name: true, description: true, capacity: true, priceCents: true, allowWaitlist: true } },
      _count: { select: { sessions: true } },
      enrollments: { where: { status: 'ENROLLED' }, select: { id: true } },
    },
  })

  return NextResponse.json(
    runs.map(r => {
      const cap = effectiveCapacity(r.capacity, r.package.capacity)
      const left = seatsRemaining(cap, r.enrollments.length)
      return {
        id: r.id,
        name: r.name,
        scheduleNote: r.scheduleNote,
        startDate: r.startDate.toISOString(),
        sessionCount: r._count.sessions,
        priceCents: r.package.priceCents,
        description: r.package.description,
        seatsLeft: left, // null = unlimited
        full: left === 0,
        waitlistAvailable: left === 0 && r.package.allowWaitlist,
      }
    }),
  )
}

const schema = z.object({
  runId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  dogName: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
})

export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  if (!PUBLIC_CLASS_ENROLLMENT_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { formId } = await params
  const form = await trainerForForm(formId)
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // The run must belong to this trainer and be publicly enrollable.
  const run = await prisma.classRun.findFirst({
    where: {
      id: parsed.data.runId,
      trainerId: form.trainerId,
      status: 'SCHEDULED',
      package: { isGroup: true, publicEnrollment: true, ...offeringVisibleWhere() },
    },
    select: { id: true, name: true },
  })
  if (!run) return NextResponse.json({ error: 'Class not available' }, { status: 404 })

  const enquiry = await prisma.enquiry.create({
    data: {
      trainerId: form.trainerId,
      formId: form.id,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone?.trim() || null,
      dogName: parsed.data.dogName?.trim() || null,
      message:
        `Class enrolment request: ${run.name}` +
        (parsed.data.message?.trim() ? `\n\n${parsed.data.message.trim()}` : ''),
      // Structured marker so the trainer's accept flow can auto-enrol into
      // this run once that wiring lands (Stripe-gated for paid classes).
      customFieldValues: { requestedClassRunId: run.id },
    },
    select: { id: true },
  })

  await notifyEnquiryTrainer({ enquiryId: enquiry.id })
  return NextResponse.json({ ok: true }, { status: 201 })
}
