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
import { resolvePackagePricing } from '@/lib/session-pricing'
import { visibleFromInstant } from '@/lib/offering-visibility'

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
  // How the price was expressed, when the trainer priced by the session. The
  // TOTAL is derived from it below — never taken from the payload — so the two
  // columns cannot be saved disagreeing with each other.
  pricePerSessionCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
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
  // A one-off EVENT — a workshop/seminar/meet-up people buy a ticket to. The
  // creation surface is the only thing that knows this (the trainer picked
  // "One-off event", or came in on /offerings/new?kind=oneoff), so it is stored
  // rather than guessed later from the shape. Defaults false: anything created
  // by any other path is a class.
  isEvent: z.boolean().optional(),
  capacity: z.number().int().min(0).max(1000).nullable().optional(),
  allowDropIn: z.boolean().optional(),
  dropInPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  recurrenceRule: z.string().max(200).nullable().optional(),
  allowWaitlist: z.boolean().optional(),
  publicEnrollment: z.boolean().optional(),
  clientSelfBook: z.boolean().optional(),
  selfBookRequiresApproval: z.boolean().optional(),
  // The calendar DAY the trainer wants clients to start seeing this, in their
  // own zone. null / omitted = visible immediately, which is the default and
  // what every offering built before this meant. Resolved to the instant that
  // day begins for them before it is stored — see lib/offering-visibility.
  visibleFromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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

  // "Show from 1 December" is a day in the TRAINER's life, not in UTC's. The
  // zone is resolved here so what gets stored is the instant that day begins
  // for them — a UTC midnight would publish a Los Angeles term a day early.
  const trainerTz =
    (await prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { user: { select: { timezone: true } } },
    }))?.user?.timezone || 'Pacific/Auckland'

  // Settle the price BEFORE anything reads it. When the trainer priced by the
  // session the total is derived here, so every rule below — and the row that
  // gets written — sees the real figure rather than whatever total the client
  // happened to send alongside it.
  const pricing = resolvePackagePricing({
    pricePerSessionCents: parsed.data.pricePerSessionCents,
    priceCents: parsed.data.priceCents,
    sessionCount: parsed.data.sessionCount,
  })

  // A special price above the normal price would be shown to clients as the
  // discounted amount and charged as such — an overcharge dressed as a saving.
  // The form says so too, but the form isn't the guarantee.
  if (!isValidSpecialPrice(pricing.priceCents, parsed.data.specialPriceCents)) {
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

  // What kind of thing this is, settled once. An event is a GROUP offering that
  // isn't a drop-in class or a daycare programme — those have their own screens,
  // and a row flagged as two kinds at once would appear on both or neither.
  // Everything else is false, which is why a class created as a class stays one
  // no matter how few sessions it has.
  const isGroup = parsed.data.isGroup ?? false
  const isPuppySchool = parsed.data.isPuppySchool ?? false
  const allowDropIn = dropIn ? dropIn.allowDropIn : (parsed.data.allowDropIn ?? false)
  const isEvent = (parsed.data.isEvent ?? false) && isGroup && !allowDropIn && !isPuppySchool

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
        priceCents: pricing.priceCents,
        pricePerSessionCents: pricing.pricePerSessionCents,
        specialPriceCents: parsed.data.specialPriceCents ?? null,
        color: parsed.data.color ?? null,
        defaultSessionFormId: parsed.data.defaultSessionFormId ?? null,
        requireSessionNotes: parsed.data.requireSessionNotes ?? true,
        isGroup,
        isPuppySchool,
        isEvent,
        capacity: parsed.data.capacity ?? null,
        allowDropIn,
        dropInPriceCents: dropIn ? dropIn.dropInPriceCents : (parsed.data.dropInPriceCents ?? null),
        recurrenceRule: parsed.data.recurrenceRule || null,
        allowWaitlist: parsed.data.allowWaitlist ?? false,
        publicEnrollment: parsed.data.publicEnrollment ?? false,
        clientSelfBook: parsed.data.clientSelfBook ?? false,
        selfBookRequiresApproval: parsed.data.selfBookRequiresApproval ?? true,
        visibleFrom: visibleFromInstant(parsed.data.visibleFromDate, trainerTz),
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
