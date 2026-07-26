import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { MAX_BUFFER_MINS } from '@/lib/buffer'
import {
  slotSchema, replacePackageSlots, derivedDropInFields, runStartFromSlots,
  ticketTierSchema, replaceTicketTiers,
} from '@/lib/package-slots'
import { createClassRunIn } from '@/lib/class-runs'
import { syncClassSessions } from '@/lib/class-session-sync'
import { isValidSpecialPrice, SPECIAL_PRICE_TOO_HIGH } from '@/lib/special-price'

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  // 0 = ongoing (no fixed end). The trainer picks an end date when assigning.
  sessionCount: z.number().int().min(0).max(52),
  weeksBetween: z.number().int().min(0).max(52),
  durationMins: z.number().int().min(15).max(480),
  // "Gap before the next session" — turnaround/travel time blocked out after
  // each session of this package. 0 = back-to-back.
  bufferMins: z.number().int().min(0).max(MAX_BUFFER_MINS).optional(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  // Prices stored in cents. Accept 0 (free) up to a sane upper bound.
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  specialPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  // Tailwind palette key. Keep this list in sync with PACKAGE_COLORS in
  // schedule-view.tsx — both must include any new option.
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
  defaultSessionFormId: z.string().nullable().optional(),
  requireSessionNotes: z.boolean().optional(),
  // Group-class config. isGroup flips this package from the 1:1
  // ClientPackage path to the ClassRun (cohort) path.
  isGroup: z.boolean().optional(),
  // A puppy school / daycare offering: day-parted, ongoing, run from the Puppy
  // School workspace. Implies isGroup + allowDropIn (each day-part books like a
  // drop-in session).
  isPuppySchool: z.boolean().optional(),
  capacity: z.number().int().min(0).max(1000).nullable().optional(),
  allowDropIn: z.boolean().optional(),
  dropInPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  recurrenceRule: z.string().max(200).nullable().optional(),
  allowWaitlist: z.boolean().optional(),
  publicEnrollment: z.boolean().optional(),
  clientSelfBook: z.boolean().optional(),
  selfBookRequiresApproval: z.boolean().optional(),
  xeroAccountCode: z.string().max(50).nullable().optional(),
  // Tri-state "require payment to book": null = inherit the trainer default,
  // true = pay up front, false = book now / pay later.
  requirePayment: z.boolean().nullable().optional(),
  // A drop-in class's schedule: one entry per weekly slot, each pricing and
  // capping itself. Present = this is a drop-in offering; its slots become the
  // session series and override allowDropIn/dropInPriceCents.
  sessionSlots: z.array(slotSchema).max(50).optional(),
  // Scheduling. A group offering (class / drop-in / one-off event) saved with a
  // start date is SCHEDULED as well as defined: it gets its first ClassRun and
  // that run's sessions, so it shows up on /classes or /events straight away.
  // Omit startAt to define the offering without putting it in the diary yet.
  startAt: z.string().datetime().optional(),
  scheduleNote: z.string().max(120).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  assignedMembershipIds: z.array(z.string()).max(50).optional(),
  // What a one-off event sells: "Early bird $40 cap 20", "General $60".
  ticketTiers: z.array(ticketTierSchema).max(20).optional(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const packages = await prisma.package.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { assignments: true } } },
  })
  return NextResponse.json(packages)
}

export async function POST(req: Request) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // A special price above the normal price would be shown to clients as the
  // discounted amount and charged as such — an overcharge dressed as a saving.
  // The form says so too, but the form isn't the guarantee.
  if (!isValidSpecialPrice(parsed.data.priceCents, parsed.data.specialPriceCents)) {
    return NextResponse.json({ error: SPECIAL_PRICE_TOO_HIGH }, { status: 400 })
  }
  // Same rule per drop-in slot — a drop-in has no headline price, each slot
  // prices itself, so this is where the rule bites for that kind.
  if (parsed.data.sessionSlots?.some(s => !isValidSpecialPrice(s.priceCents, s.specialPriceCents))) {
    return NextResponse.json({ error: SPECIAL_PRICE_TOO_HIGH }, { status: 400 })
  }

  // Append new packages at the end of the list
  const max = await prisma.package.aggregate({
    where: { trainerId },
    _max: { order: true },
  })
  const nextOrder = (max._max.order ?? -1) + 1

  // Slots are the source of truth for a drop-in's pricing, so derive the
  // package-level headline fields from them rather than trusting the payload.
  const slots = parsed.data.sessionSlots
  const dropIn = slots ? derivedDropInFields(slots) : null

  // When to schedule the first run from. A class/event names its start date
  // outright; a drop-in doesn't have one field for it — each slot carries its
  // own "Starts from" — so fall back to the earliest of those, then to today.
  const startAt = parsed.data.startAt
    ? new Date(parsed.data.startAt)
    : slots?.length
      ? (runStartFromSlots(slots) ?? new Date())
      : null
  let runId: string | null = null
  let createdSessionIds: string[] = []

  const pkg = await prisma.$transaction(async (tx) => {
    const created = await tx.package.create({
      data: {
        trainerId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        imageUrl: parsed.data.imageUrl ?? null,
        // The offering's own venue. It used to be handed straight to the run
        // below and nowhere else, so defining an offering WITHOUT a start date
        // — no run to write it to — accepted the address and threw it away.
        location: parsed.data.location?.trim() || null,
        sessionCount: parsed.data.sessionCount,
        weeksBetween: parsed.data.weeksBetween,
        durationMins: parsed.data.durationMins,
        bufferMins: parsed.data.bufferMins ?? 0,
        sessionType: parsed.data.sessionType ?? 'IN_PERSON',
        priceCents: parsed.data.priceCents ?? null,
        specialPriceCents: parsed.data.specialPriceCents ?? null,
        color: parsed.data.color ?? null,
        defaultSessionFormId: parsed.data.defaultSessionFormId ?? null,
        requireSessionNotes: parsed.data.requireSessionNotes ?? true,
        isGroup: parsed.data.isGroup ?? false,
        isPuppySchool: parsed.data.isPuppySchool ?? false,
        capacity: parsed.data.capacity ?? null,
        allowDropIn: dropIn ? dropIn.allowDropIn : (parsed.data.allowDropIn ?? false),
        dropInPriceCents: dropIn ? dropIn.dropInPriceCents : (parsed.data.dropInPriceCents ?? null),
        recurrenceRule: parsed.data.recurrenceRule || null,
        allowWaitlist: parsed.data.allowWaitlist ?? false,
        publicEnrollment: parsed.data.publicEnrollment ?? false,
        clientSelfBook: parsed.data.clientSelfBook ?? false,
        selfBookRequiresApproval: parsed.data.selfBookRequiresApproval ?? true,
        xeroAccountCode: parsed.data.xeroAccountCode || null,
        requirePayment: parsed.data.requirePayment ?? null,
        order: nextOrder,
      },
    })
    if (slots) await replacePackageSlots(tx, created.id, trainerId, slots)
    if (parsed.data.ticketTiers) await replaceTicketTiers(tx, created.id, parsed.data.ticketTiers)

    // Defining a group offering with a start date also SCHEDULES it — same
    // transaction, so we can never end up with a class that has no run (and
    // therefore never appears on /classes or /events).
    if (created.isGroup && startAt) {
      const run = await createClassRunIn(tx, {
        trainerId,
        packageId: created.id,
        name: created.name,
        startDate: startAt,
        scheduleNote: parsed.data.scheduleNote ?? null,
        capacity: parsed.data.capacity ?? null,
        imageUrl: parsed.data.imageUrl ?? null,
        location: parsed.data.location ?? null,
        assignedMembershipIds: parsed.data.assignedMembershipIds,
        requirePayment: parsed.data.requirePayment ?? null,
      })
      runId = run.id
      createdSessionIds = run.createdSessionIds
    }
    return created
  })

  // Mirror the new sessions to Google Calendar post-commit, like every other
  // session-creating path.
  if (createdSessionIds.length) await syncClassSessions(createdSessionIds)

  return NextResponse.json({ ...pkg, classRunId: runId }, { status: 201 })
}
