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

/**
 * Make the stored slots for `packageId` match `slots` exactly.
 *
 * Slots sent with an id that already belongs to this package are UPDATED in
 * place — that keeps the id stable, and with it the link from every session
 * already generated off that slot (TrainingSession.packageSessionSlotId), so
 * re-saving a class never orphans the prices of sessions in the diary. Slots the
 * payload omits are deleted (their sessions survive; the FK is SetNull).
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
    await tx.packageSessionSlot.deleteMany({ where: { id: { in: stale }, packageId } })
  }
}
