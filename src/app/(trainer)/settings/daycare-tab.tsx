import { prisma } from '@/lib/prisma'
import { trainerRegionCode } from '@/lib/country'
import { DaycarePanel, type DaycareSchool } from './daycare-panel'

// Settings → Daycare. The daycare's ONLY home for configuration.
//
// The board at /doggy-daycare used to carry a "+ New school" button and a day
// picker in its header; both were removed (the button read as "school", which
// this isn't, and the picker was a second control for a scheduler setting).
// That left a daycare with nowhere to be set up or changed at all. This is it.
//
// Deliberately an ASSEMBLY of things that already exist:
//   • no daycare yet          → <PuppySchoolSetup>, the same form the board
//                               used to open (components/trainer/puppy-school-setup)
//   • the offering's name/price → the real package editor at /packages/:id/edit
//   • the day-parts            → a table you read down, one row per part, and a
//                               row opens <SessionSlotsEditor> — the same slot
//                               editor the drop-in class form uses
//                               (components/shared/session-slots) — in a
//                               FullScreenSheet
// Nothing here is a second editor of anything.
export async function DaycareTab({ companyId }: { companyId: string }) {
  const [pkgs, locations, profile] = await Promise.all([
    prisma.package.findMany({
      where: { trainerId: companyId, isPuppySchool: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        priceCents: true,
        dropInPriceCents: true,
        capacity: true,
        allowWaitlist: true,
        clientSelfBook: true,
        sessionSlots: { orderBy: { order: 'asc' } },
      },
    }),
    prisma.location.findMany({
      where: { trainerId: companyId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: companyId },
      select: { addressCountry: true, signupCountry: true },
    }),
  ])

  const schools: DaycareSchool[] = pkgs.map(p => ({
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    dropInPriceCents: p.dropInPriceCents,
    capacity: p.capacity,
    allowWaitlist: p.allowWaitlist,
    clientSelfBook: p.clientSelfBook,
    slots: p.sessionSlots.map(s => ({
      id: s.id,
      order: s.order,
      startDate: s.startDate ? s.startDate.toISOString() : null,
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
      gapMins: s.gapMins,
      capacity: s.capacity,
      priceCents: s.priceCents,
      specialPriceCents: s.specialPriceCents,
      xeroAccountCode: s.xeroAccountCode,
      requirePayment: s.requirePayment,
      locationId: s.locationId,
      recurrenceRule: s.recurrenceRule,
      assignedMembershipIds: s.assignedMembershipIds,
    })),
  }))

  return (
    <DaycarePanel
      schools={schools}
      locations={locations}
      region={profile ? trainerRegionCode(profile) : undefined}
    />
  )
}
