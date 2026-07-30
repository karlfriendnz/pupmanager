import { prisma } from '@/lib/prisma'
import { getEnabledAddons } from '@/lib/billing'
import type { AddonId } from '@/lib/pricing'
import { INTEGRATIONS, integrationState } from '@/lib/integrations'
import { IntegrationsPanel, type IntegrationCard } from './integrations-panel'

/**
 * Settings → Integrations. What we're connected to, and whether it's working.
 *
 * The state each card shows is asked of the REAL connection, not of the add-on
 * switch: every one of these can be switched on and still not connected, and that
 * gap is exactly what a trainer opens this screen to find. Answering it from the
 * switch alone would show four green ticks on a business syncing nothing.
 */
export async function IntegrationsTab({ companyId }: { companyId: string }) {
  const [enabledAddons, xero, gcal, profile, bookingPages] = await Promise.all([
    getEnabledAddons(companyId),
    prisma.xeroConnection.findUnique({ where: { trainerId: companyId }, select: { id: true } }),
    // Per staff member, so the business counts as connected when ANY member has
    // linked their calendar — one trainer syncing is a working integration.
    prisma.googleCalendarConnection.count({ where: { companyId } }),
    prisma.trainerProfile.findUnique({
      where: { id: companyId },
      select: { connectChargesEnabled: true, acceptPaymentsEnabled: true },
    }),
    prisma.bookingPage.count({ where: { trainerId: companyId } }),
  ])

  // Connected means "money can actually move": an account that can't take charges
  // isn't connected however far through onboarding it got.
  const stripeLive = !!profile?.connectChargesEnabled && !!profile?.acceptPaymentsEnabled

  const connected: Record<string, boolean> = {
    googlecalendar: gcal > 0,
    xero: !!xero,
    stripe: stripeLive,
    website: bookingPages > 0,
  }

  const cards: IntegrationCard[] = INTEGRATIONS.map(def => ({
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    manageHref: def.manageHref,
    // No add-on gate (the website tools) means it's always available, so its
    // state is simply whether anything has been set up.
    state: integrationState(
      def.addonId ? enabledAddons.has(def.addonId as AddonId) : true,
      connected[def.id] ?? false,
    ),
  }))

  return <IntegrationsPanel cards={cards} />
}
