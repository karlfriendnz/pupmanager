import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import type { PermissionMap } from '@/lib/permissions'
import type { CompanyRole } from '@/generated/prisma'
import { configurableFeatures, groupedFeatures, featureIsOn } from '@/lib/configurable-features'
import { ConfigurePanel } from './configure-panel'

/**
 * Settings → Configure. Everything included with the plan, as switches.
 *
 * Reads the TrainerAddon rows once and resolves each feature against its own
 * default, because "no row" doesn't mean "off": a trainer who has never opened
 * Settings still has the client app and session notes (defaultOn). Getting that
 * wrong would show a switch as off for a feature they're actively using.
 */
export async function ConfigureTab({
  companyId,
  role,
  permissions,
}: {
  companyId: string
  role: CompanyRole
  permissions: PermissionMap
}) {
  const rows = await prisma.trainerAddon.findMany({
    where: { trainerId: companyId },
    select: { itemId: true, active: true },
  })
  const byId = new Map(rows.map(r => [r.itemId, r.active]))
  const activeIds = new Set(rows.filter(r => r.active).map(r => r.itemId))

  // activeIds decides whether an UNADVERTISED feature is listed — someone who
  // turned one on has to be able to turn it off again.
  const groups = groupedFeatures(activeIds)
  const initialOn = Object.fromEntries(
    configurableFeatures(activeIds).map(f => [f.id, featureIsOn(f.id, byId)]),
  )

  return (
    <ConfigurePanel
      groups={groups}
      initialOn={initialOn}
      // These cost nothing, so the gate is "can this person change settings",
      // not the spend permission the paid Add-ons page needs.
      canEdit={can('settings.edit', role, permissions)}
    />
  )
}
