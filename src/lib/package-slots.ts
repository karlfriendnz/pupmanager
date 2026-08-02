// Persistence for a drop-in class's schedule slots (PackageSessionSlot).
//
// A drop-in offering isn't "N sessions, W weeks apart" — it's a list of slots,
// each with its own day, time, venue, staff, capacity and price. The editor in
// components/shared/session-slots.tsx sends them whole on every save, so this
// module owns the reconcile (keep / update / create / delete) and, crucially,
// the tenancy checks: a slot may only point at a location and team members that
// belong to the saving trainer's own company.

import { z } from 'zod'
import { MAX_BUFFER_MINS } from './buffer'
import type { Prisma, PrismaClient } from '@/generated/prisma'

type Tx = PrismaClient | Prisma.TransactionClient

export const slotSchema = z.object({
  // Present for a slot that already exists; absent/unknown = create a new one.
  id: z.string().optional(),
  // "YYYY-MM-DD"; omitted = start from the run's start date.
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  day: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  gapMins: z.number().int().min(0).max(MAX_BUFFER_MINS).optional(),
  capacity: z.number().int().min(0).max(1000).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  specialPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  xeroAccountCode: z.string().max(50).nullable().optional(),
  requirePayment: z.boolean().optional(),
  locationId: z.string().nullable().optional(),
  recurrenceRule: z.string().max(200).nullable().optional(),
  assignedMembershipIds: z.array(z.string()).max(20).optional(),
})

export type SlotInput = z.infer<typeof slotSchema>

/**
 * The package-level drop-in fields implied by a set of slots. The slots are the
 * source of truth for what a session costs; these are the headline values the
 * rest of the app (client wizard type-card, package list) still reads, so we
 * derive them here rather than trusting whatever the form posted.
 *
 * dropInPriceCents = the cheapest slot price, so "from $20" is never a lie.
 */
export function derivedDropInFields(slots: SlotInput[]): {
  allowDropIn: boolean
  dropInPriceCents: number | null
} {
  if (slots.length === 0) return { allowDropIn: true, dropInPriceCents: null }
  const prices = slots
    .map((s) => (typeof s.specialPriceCents === 'number' ? s.specialPriceCents : s.priceCents))
    .filter((p): p is number => typeof p === 'number')
  return {
    allowDropIn: true,
    dropInPriceCents: prices.length ? Math.min(...prices) : null,
  }
}

export const ticketTierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  capacity: z.number().int().min(0).max(100_000).nullable().optional(),
  xeroAccountCode: z.string().max(50).nullable().optional(),
})

export type TicketTierInput = z.infer<typeof ticketTierSchema>

/**
 * Make the stored ticket tiers for `packageId` match `tiers` exactly. Same
 * keep-the-id reconcile as the schedule slots, so a tier a client has already
 * bought against isn't silently replaced by a new row on the next save.
 * Unnamed tiers are dropped — the editor starts with a blank row.
 */
export async function replaceTicketTiers(
  tx: Tx,
  packageId: string,
  tiers: TicketTierInput[],
): Promise<void> {
  const wanted = tiers.filter((t) => t.name.trim())
  const existing = await tx.packageTicketTier.findMany({ where: { packageId }, select: { id: true } })
  const existingIds = new Set(existing.map((t) => t.id))

  const fields = (t: TicketTierInput, order: number) => ({
    order,
    name: t.name.trim(),
    priceCents: t.priceCents ?? null,
    capacity: t.capacity ?? null,
    xeroAccountCode: t.xeroAccountCode || null,
  })

  const keptIds: string[] = []
  for (const [i, t] of wanted.entries()) {
    if (t.id && existingIds.has(t.id)) {
      await tx.packageTicketTier.update({ where: { id: t.id }, data: fields(t, i) })
      keptIds.push(t.id)
    } else {
      const created = await tx.packageTicketTier.create({ data: { packageId, ...fields(t, i) } })
      keptIds.push(created.id)
    }
  }

  const stale = [...existingIds].filter((id) => !keptIds.includes(id))
  if (stale.length) {
    await tx.packageTicketTier.deleteMany({ where: { id: { in: stale }, packageId } })
  }
}

/**
 * When a drop-in class's first run should start: the earliest "Starts from"
 * across its slots. Null when no slot names one — the caller then starts from
 * today, so a schedule with only days and times still lands in the diary.
 *
 * A drop-in has no start-date field of its own (each slot carries one), so
 * without this it would save with no run at all — and a class with no run is
 * invisible to clients, which is the exact failure this whole area had.
 */
export function runStartFromSlots(slots: SlotInput[]): Date | null {
  const dates = slots
    .map((s) => s.startDate)
    .filter((d): d is string => !!d)
    .sort()
  return dates.length ? new Date(`${dates[0]}T00:00:00.000Z`) : null
}

/**
 * Make the stored slots for `packageId` match `slots` exactly.
 *
 * Slots sent with an id that already belongs to this package are UPDATED in
 * place — that keeps the id stable, and with it the link from every session
 * already generated off that slot (TrainingSession.packageSessionSlotId), so
 * re-saving a class never orphans the prices of sessions in the diary.
 *
 * ── Slots the payload omits: taking a day-part OFF the timetable ────────────
 *
 * The FK is SetNull, so deleting the slot row alone used to leave every session
 * it had generated behind with a null slot id: up to a year of dates the trainer
 * had just removed, still on the board, still bookable — and priced off the
 * package's headline rate now that their own slot was gone. Nothing could ever
 * tidy them either, because the top-up keys on a non-null slot id, so an orphan
 * is invisible to it forever. Removing the afternoon left the afternoon selling.
 *
 * So a removed day-part takes its FUTURE sessions with it — but only the ones
 * NOBODY IS IN. This is the rule commit 59a02f8 set for cancelling a single
 * occurrence, applied to a whole slot: a session with a booking or an attendance
 * mark is somebody's arrangement, and deleting it would cascade the register and
 * every casual booking away, silently, from the people who most need telling.
 * Those stay, as does everything already in the past, which is a record of what
 * happened rather than a plan. What survives is orphaned and inert — no longer
 * topped up, no longer part of a series — and the trainer cancels or moves each
 * one with the per-occurrence tools, having been able to see who is in it.
 *
 * Locations and team members that aren't this company's are silently dropped
 * rather than rejected — same posture as setRunTrainers.
 */
export async function replacePackageSlots(
  tx: Tx,
  packageId: string,
  trainerId: string,
  slots: SlotInput[],
): Promise<void> {
  const wantedLocationIds = slots.map((s) => s.locationId).filter((v): v is string => !!v)
  const ownLocations = wantedLocationIds.length
    ? new Set(
        (
          await tx.location.findMany({
            where: { id: { in: wantedLocationIds }, trainerId },
            select: { id: true },
          })
        ).map((l) => l.id),
      )
    : new Set<string>()

  const wantedMemberIds = [...new Set(slots.flatMap((s) => s.assignedMembershipIds ?? []))]
  const ownMembers = wantedMemberIds.length
    ? new Set(
        (
          await tx.trainerMembership.findMany({
            where: { id: { in: wantedMemberIds }, companyId: trainerId },
            select: { id: true },
          })
        ).map((m) => m.id),
      )
    : new Set<string>()

  const existing = await tx.packageSessionSlot.findMany({
    where: { packageId },
    select: { id: true },
  })
  const existingIds = new Set(existing.map((s) => s.id))

  const fields = (s: SlotInput, order: number) => ({
    order,
    startDate: s.startDate ? new Date(`${s.startDate}T00:00:00.000Z`) : null,
    day: s.day,
    startTime: s.startTime,
    endTime: s.endTime,
    gapMins: s.gapMins ?? 0,
    capacity: s.capacity ?? null,
    priceCents: s.priceCents ?? null,
    specialPriceCents: s.specialPriceCents ?? null,
    xeroAccountCode: s.xeroAccountCode || null,
    requirePayment: s.requirePayment ?? false,
    locationId: s.locationId && ownLocations.has(s.locationId) ? s.locationId : null,
    recurrenceRule: s.recurrenceRule || null,
    assignedMembershipIds: (s.assignedMembershipIds ?? []).filter((id) => ownMembers.has(id)),
  })

  const keptIds: string[] = []
  for (const [i, s] of slots.entries()) {
    if (s.id && existingIds.has(s.id)) {
      await tx.packageSessionSlot.update({ where: { id: s.id }, data: fields(s, i) })
      keptIds.push(s.id)
    } else {
      const created = await tx.packageSessionSlot.create({
        data: { packageId, ...fields(s, i) },
      })
      keptIds.push(created.id)
    }
  }

  const stale = [...existingIds].filter((id) => !keptIds.includes(id))
  if (stale.length) {
    // Order matters: the sessions have to go while they can still be found by
    // slot id. Once the slot row is gone the FK is null and they are unfindable.
    await tx.trainingSession.deleteMany({
      where: {
        packageSessionSlotId: { in: stale },
        scheduledAt: { gt: new Date() },
        dropInEnrollments: { none: {} },
        attendance: { none: {} },
      },
    })
    await tx.packageSessionSlot.deleteMany({ where: { id: { in: stale }, packageId } })
  }
}
