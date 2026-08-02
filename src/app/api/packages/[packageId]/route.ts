import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { MAX_BUFFER_MINS } from '@/lib/buffer'
import { syncOfferingRun, ClassError } from '@/lib/class-runs'
import { syncClassSessions, removeClassEvents } from '@/lib/class-session-sync'
import {
  slotSchema, replacePackageSlots, derivedDropInFields,
  ticketTierSchema, replaceTicketTiers,
} from '@/lib/package-slots'
import { isValidSpecialPrice, SPECIAL_PRICE_TOO_HIGH } from '@/lib/special-price'
import { resolvePackagePricing } from '@/lib/session-pricing'
import { offeringListHref, offeringKindLabel } from '@/lib/run-kind'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  sessionCount: z.number().int().min(0).max(52).optional(),
  weeksBetween: z.number().int().min(0).max(52).optional(),
  durationMins: z.number().int().min(15).max(480).optional(),
  // "Gap before the next session". Only ever applies to sessions booked FROM
  // NOW ON — existing sessions keep the buffer they were booked with.
  bufferMins: z.number().int().min(0).max(MAX_BUFFER_MINS).optional(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  specialPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  // Priced by the session. The total is re-derived from it below — including
  // when only the session count moves — so it can never go stale against it.
  pricePerSessionCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
  defaultSessionFormId: z.string().nullable().optional(),
  requireSessionNotes: z.boolean().optional(),
  isGroup: z.boolean().optional(),
  // Whether this offering is a one-off EVENT. Optional like everything else
  // here: omitting it leaves the stored kind alone, so a caller that doesn't
  // know about events can never reclassify one by accident.
  isEvent: z.boolean().optional(),
  capacity: z.number().int().min(0).max(1000).nullable().optional(),
  allowDropIn: z.boolean().optional(),
  dropInPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  recurrenceRule: z.string().max(200).nullable().optional(),
  allowWaitlist: z.boolean().optional(),
  publicEnrollment: z.boolean().optional(),
  clientSelfBook: z.boolean().optional(),
  selfBookRequiresApproval: z.boolean().optional(),
  xeroAccountCode: z.string().max(50).nullable().optional(),
  // Tri-state "require payment to book": null = inherit trainer default.
  requirePayment: z.boolean().nullable().optional(),
  // A drop-in class's schedule, sent whole. Omitted = leave the stored slots
  // alone; [] = clear them.
  sessionSlots: z.array(slotSchema).max(50).optional(),
  // A one-off event's ticket types, sent whole. Omitted = leave them alone.
  ticketTiers: z.array(ticketTierSchema).max(20).optional(),
  // The scheduled class behind this offering — applied to its run when it has
  // exactly one (see syncOfferingRun). This form edits the WHOLE class, dates
  // included; moving them is refused once attendance has been recorded.
  startAt: z.string().datetime().optional(),
  // Sessions the trainer chose to drop when shrinking a class. Naming them
  // replaces the wholesale rebuild, so the sessions that stay keep their ids
  // and everything hanging off them.
  removeSessionIds: z.array(z.string()).max(200).optional(),
  status: z.enum(['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED']).optional(),
  scheduleNote: z.string().max(120).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  assignedMembershipIds: z.array(z.string()).max(50).optional(),
})

async function ownPackage(packageId: string, trainerId: string) {
  return prisma.package.findFirst({ where: { id: packageId, trainerId } })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { packageId } = await params
  const current = await ownPackage(packageId, trainerId)
  if (!current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // A special price is a discount; above the normal price it's an overcharge
  // wearing a saving's clothes. This is a PARTIAL update, so a patch that
  // changes only one of the two is checked against the value already stored —
  // otherwise you could raise the special price today and lower the price
  // tomorrow and end up in exactly the state the rule forbids.
  //
  // Settle the price first, on the same partial-update terms: each of the three
  // inputs falls back to what is stored. That fallback is what re-totals a
  // per-session offering when only its SESSION COUNT is patched — the case the
  // whole column exists for. A four-session course at $30 a session that becomes
  // six sessions is re-priced to $180 here, rather than keeping a $120 total
  // that no longer matches the figure the trainer typed.
  const pricing = resolvePackagePricing({
    pricePerSessionCents: parsed.data.pricePerSessionCents !== undefined
      ? parsed.data.pricePerSessionCents
      : current.pricePerSessionCents,
    priceCents: parsed.data.priceCents !== undefined ? parsed.data.priceCents : current.priceCents,
    sessionCount: parsed.data.sessionCount !== undefined ? parsed.data.sessionCount : current.sessionCount,
  })
  const nextPrice = pricing.priceCents
  const nextSpecial = parsed.data.specialPriceCents !== undefined ? parsed.data.specialPriceCents : current.specialPriceCents
  if (!isValidSpecialPrice(nextPrice, nextSpecial)) {
    return NextResponse.json({ error: SPECIAL_PRICE_TOO_HIGH }, { status: 400 })
  }
  // Each drop-in slot prices itself, so the rule has to reach them too.
  if (parsed.data.sessionSlots?.some(s => !isValidSpecialPrice(s.priceCents, s.specialPriceCents))) {
    return NextResponse.json({ error: SPECIAL_PRICE_TOO_HIGH }, { status: 400 })
  }

  // Converting between 1:1 and group flips which half of the system owns this
  // package: a group package is run as ClassRuns with a shared roster, a 1:1 one
  // as per-client ClientPackage assignments. Flipping it while either exists
  // would strand them — a class run whose package is no longer a class, or
  // assignments against a package that no longer works that way — so the
  // conversion is refused while the package is in use rather than half-applied.
  let extra: Record<string, unknown> = {}
  if (parsed.data.isGroup !== undefined) {
    const current = await prisma.package.findUnique({
      where: { id: packageId },
      select: { isGroup: true },
    })
    if (current && current.isGroup !== parsed.data.isGroup) {
      if (current.isGroup) {
        const runs = await prisma.classRun.count({ where: { packageId } })
        if (runs > 0) {
          return NextResponse.json(
            { error: `This is running as ${runs} class${runs === 1 ? '' : 'es'}. Delete or finish ${runs === 1 ? 'it' : 'them'} before turning it back into a 1:1 session.` },
            { status: 409 },
          )
        }
        // Group-only settings are meaningless on a 1:1 package — clear them
        // here too, not just in the form, so any caller converts cleanly.
        // allowWaitlist is NOT one of them: a full 1:1 package can keep a
        // waitlist just as a class can.
        extra = {
          capacity: null,
          allowDropIn: false,
          // A 1:1 session is never an event.
          isEvent: false,
          dropInPriceCents: null,
          recurrenceRule: null,
          publicEnrollment: false,
          // A drop-in schedule is meaningless on a 1:1 package.
          sessionSlots: { deleteMany: {} },
        }
      } else {
        const assigned = await prisma.clientPackage.count({ where: { packageId } })
        if (assigned > 0) {
          return NextResponse.json(
            { error: `${assigned} client${assigned === 1 ? ' is' : 's are'} assigned to this 1:1 session. Convert a copy instead, or unassign first.` },
            { status: 409 },
          )
        }
      }
    }
  }

  // Slots are a child table, not a column — keep them out of the package's own
  // update payload and reconcile them separately. When they're sent, they also
  // define the drop-in headline price, so it can't drift from the schedule.
  const {
    sessionSlots, ticketTiers,
    scheduleNote, location, imageUrl, assignedMembershipIds, startAt, status, removeSessionIds,
    ...columns
  } = parsed.data
  const dropIn = sessionSlots ? derivedDropInFields(sessionSlots) : null

  // Write the settled price only when the patch actually said something about
  // pricing (or about the session count the total is derived from). Every other
  // key here means "leave it alone", and the price is no different.
  if (
    parsed.data.priceCents !== undefined ||
    parsed.data.pricePerSessionCents !== undefined ||
    parsed.data.sessionCount !== undefined
  ) {
    columns.priceCents = pricing.priceCents
    columns.pricePerSessionCents = pricing.pricePerSessionCents
  }

  // What this offering IS may only change when the caller says so — and only to
  // something coherent. An event is a group offering that is neither a drop-in
  // class nor a daycare programme, so resolve the flag against what the row will
  // BE after this patch rather than against the payload alone. Omitting the key
  // leaves the stored kind untouched: editing a class cannot silently make it an
  // event, which is precisely how one customer's classes used to disappear.
  if (columns.isEvent !== undefined) {
    const nextGroup = columns.isGroup !== undefined ? columns.isGroup : current.isGroup
    const nextDropIn = dropIn
      ? dropIn.allowDropIn
      : columns.allowDropIn !== undefined ? columns.allowDropIn : current.allowDropIn
    columns.isEvent = columns.isEvent && nextGroup && !nextDropIn && !current.isPuppySchool
  }

  // Sessions the schedule change created / removed, mirrored to Google after
  // the transaction commits.
  let createdSessionIds: string[] = []
  let deletedEventIds: string[] = []

  let pkg
  try {
  pkg = await prisma.$transaction(async (tx) => {
    const updated = await tx.package.update({
      where: { id: packageId },
      data: {
        ...columns,
        // Every other field here is optional-means-"leave it alone"; the image
        // used to be the exception. `imageUrl ?? null` cannot tell "clear it"
        // (explicit null) from "I didn't mention it" (undefined), so ANY patch
        // that omitted the key silently wiped the offering's cover photo —
        // which is exactly what the 1:1 edit form sends. Only write it when the
        // caller actually said something about it.
        ...(imageUrl !== undefined && { imageUrl }),
        // The offering's default venue, same optional-means-leave-it-alone rule
        // as the image. Before this column existed the venue was only ever
        // written to the run, so editing an offering with no run (or with
        // several cohorts, where syncOfferingRun deliberately no-ops) dropped
        // it. Writing it here can never rewrite an existing run's venue —
        // syncOfferingRun below is the only thing that touches a run.
        ...(location !== undefined && { location: location?.trim() || null }),
        ...(dropIn && {
          allowDropIn: dropIn.allowDropIn,
          dropInPriceCents: dropIn.dropInPriceCents,
        }),
        ...extra,
      },
    })
    // `extra` already cleared them on a group→1:1 conversion.
    if (sessionSlots && !('sessionSlots' in extra)) {
      await replacePackageSlots(tx, packageId, trainerId, sessionSlots)
    }
    if (ticketTiers) await replaceTicketTiers(tx, packageId, ticketTiers)

    // Editing the offering edits the class it was scheduled as — otherwise the
    // venue on screen and the venue clients are told differ, silently. (A 1:1
    // package has no run; syncOfferingRun also no-ops on a multi-cohort one.)
    if (updated.isGroup) {
      const synced = await syncOfferingRun(tx, packageId, trainerId, {
        name: columns.name,
        scheduleNote, location, imageUrl, assignedMembershipIds, status,
        // The cap belongs to the run as much as to the offering — the run's
        // value wins when seats are counted, so it has to move with the edit.
        capacity: columns.capacity,
        // The schedule too: this form edits the whole class, so changing the
        // date or the number of sessions has to move the sessions themselves.
        ...(startAt && { startDate: new Date(startAt) }),
        sessionCount: columns.sessionCount,
        weeksBetween: columns.weeksBetween,
        // `current` was read before the update above, so this is what the
        // package actually held when the trainer hit Save. Without it
        // syncOfferingRun re-reads the row it has just written and compares the
        // new value with itself, concluding nothing changed.
        prev: { sessionCount: current.sessionCount, weeksBetween: current.weeksBetween },
        // Explicit removals when the trainer shrank the class and chose which
        // sessions go. Replaces the rebuild inside syncOfferingRun.
        removeSessionIds,
        durationMins: columns.durationMins,
        bufferMins: columns.bufferMins,
        sessionType: columns.sessionType,
      })
      if (synced) {
        createdSessionIds = synced.createdSessionIds
        deletedEventIds = synced.deletedEventIds
      }
    }
    return updated
  })
  } catch (e) {
    // Refusing to move a class people have already attended is an answer the
    // trainer can act on, not a server error.
    if (e instanceof ClassError && e.code === 'HAS_ATTENDANCE') {
      return NextResponse.json({ error: e.message }, { status: 409 })
    }
    throw e
  }

  if (createdSessionIds.length) await syncClassSessions(createdSessionIds)
  if (deletedEventIds.length) await removeClassEvents(trainerId, deletedEventIds)

  return NextResponse.json(pkg)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { packageId } = await params
  const pkg = await ownPackage(packageId, trainerId)
  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Where the trainer lands afterwards. NOT always /packages — that's the 1:1
  // Sessions list, and a daycare-only trainer doesn't have it in their nav.
  const redirectTo = offeringListHref(pkg)
  const kind = offeringKindLabel(pkg)

  // ── What is actually standing in the way ────────────────────────────────────
  //
  // ClassRun.package is `onDelete: Restrict` in the schema. This route used to
  // call prisma.package.delete blind, with no pre-check and no catch: Postgres
  // refused, the route 500'd, and the form printed its generic "Could not delete
  // this offering." A DAYCARE hit it every single time, because POST
  // /api/packages schedules the run inside the same transaction that creates the
  // programme — a daycare offering always has one. Classes and events only
  // escaped it because trainers habitually delete the run first.
  const runs = await prisma.classRun.findMany({
    where: { packageId, trainerId },
    select: { id: true, sessions: { select: { googleCalendarEventId: true } } },
  })
  const runIds = runs.map((r) => r.id)

  // Deleting a run cascades its enrolments AND its sessions away, and the
  // receivable raised for an enrolment is only a SOFT link (Invoice.sourceType
  // 'CLASS_ENROLLMENT' + sourceId, deliberately no FK) — so cascading would
  // leave invoices pointing at rows that no longer exist, with no way back.
  // Money and bookings are precisely what a trainer cannot re-enter from memory,
  // so anything with people or money on it REFUSES with a reason they can act
  // on. Only a run nobody has booked and nobody has been billed for is cleared
  // out of the way, because that one is just scaffolding the create step built.
  if (runIds.length > 0) {
    const [booked, attended] = await Promise.all([
      prisma.classEnrollment.count({ where: { classRunId: { in: runIds } } }),
      prisma.sessionAttendance.count({ where: { session: { classRunId: { in: runIds } } } }),
    ])
    if (booked > 0) {
      return NextResponse.json(
        {
          error: `${booked} booking${booked === 1 ? '' : 's'} on this ${kind}. Remove ${booked === 1 ? 'it' : 'them'} first, then delete it.`,
        },
        { status: 409 },
      )
    }
    if (attended > 0) {
      return NextResponse.json(
        { error: `This ${kind} has attendance recorded. Delete the sessions first, then delete it.` },
        { status: 409 },
      )
    }
  }

  // The 1:1 side has no Restrict to stop it, which is worse rather than better:
  // ClientPackage cascades off the package, so deleting a 1:1 offering silently
  // took its assignments with it and orphaned every invoice raised against them
  // (same soft sourceType/sourceId link). Same rule as above — money refuses.
  const assignments = await prisma.clientPackage.findMany({
    where: { packageId },
    select: { id: true },
  })
  if (assignments.length > 0) {
    const assignmentIds = assignments.map((a) => a.id)
    const [invoiced, paid] = await Promise.all([
      prisma.invoice.count({
        where: { trainerId, sourceType: 'PACKAGE', sourceId: { in: assignmentIds } },
      }),
      prisma.paymentItem.count({ where: { clientPackageId: { in: assignmentIds } } }),
    ])
    if (invoiced > 0 || paid > 0) {
      return NextResponse.json(
        { error: `This ${kind} has been billed for. Deleting it would orphan those invoices — cancel them first.` },
        { status: 409 },
      )
    }
  }

  // Capture the mirrored Google event ids BEFORE the cascade wipes them, so the
  // trainer's calendar can be cleaned up after the local delete (same shape as
  // the class DELETE route).
  const deletedEventIds = runs
    .flatMap((r) => r.sessions.map((s) => s.googleCalendarEventId))
    .filter((id): id is string => !!id)

  try {
    await prisma.$transaction(async (tx) => {
      if (runIds.length > 0) {
        // Sessions cascade off the run at the FK level, but delete them
        // explicitly and tenant-scoped so the intent is enforced here too.
        await tx.trainingSession.deleteMany({ where: { classRunId: { in: runIds }, trainerId } })
        await tx.classRun.deleteMany({ where: { id: { in: runIds }, trainerId } })
      }
      await tx.package.delete({ where: { id: packageId } })
    })
  } catch (err) {
    // A delete the DB refuses is still an answer the trainer should see, not a
    // blank 500 — this is the catch whose absence caused the reported bug.
    console.error('[packages] delete failed', err)
    return NextResponse.json(
      { error: 'Could not delete this offering. Please try again.' },
      { status: 500 },
    )
  }

  if (deletedEventIds.length) await removeClassEvents(trainerId, deletedEventIds)

  return NextResponse.json({ ok: true, redirectTo })
}
