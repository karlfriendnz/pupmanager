import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { ensureTrainerSlug } from '@/lib/slug'
import { isXeroConfigured } from '@/lib/xero'
import { WebsiteIntegrationPanel } from './website-integration-panel'
import { XeroConnectionCard } from './xero-connection-card'

// Integrations settings tab — everything a trainer hooks into their own
// website: the branded client-login link, Calendly-style booking pages (+
// automations), and lead-capture embed forms. The standalone /website page's
// data loading, rendered without the page chrome (PageHeader / full-page
// wrapper live on the settings page now). Gated by settings.edit at the parent.
export async function IntegrationTab({ companyId }: { companyId: string }) {
  // canManageForms is re-derived here (the standalone page used getTrainerContext)
  // — it controls whether the embed-forms card and its query run.
  const ctx = await getTrainerContext()
  const canManageForms = ctx ? can('forms.manage', ctx.role, ctx.permissions) : false

  const slug = await ensureTrainerSlug(companyId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'

  const [bookingPages, embedForms, xero] = await Promise.all([
    prisma.bookingPage.findMany({
      where: { trainerId: companyId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { automations: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
    }),
    canManageForms
      ? prisma.embedForm.findMany({ where: { trainerId: companyId }, orderBy: { createdAt: 'desc' } })
      : Promise.resolve([]),
    prisma.xeroConnection.findUnique({
      where: { trainerId: companyId },
      select: { tenantName: true },
    }),
  ])

  return (
    <div className="w-full max-w-2xl md:max-w-[872px]">
      <div className="mb-6">
        <XeroConnectionCard
          connected={!!xero}
          orgName={xero?.tenantName ?? null}
          configured={isXeroConfigured()}
        />
      </div>
      <WebsiteIntegrationPanel
        slug={slug}
        appUrl={appUrl}
        bookingPages={bookingPages.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          enabled: p.enabled,
          headline: p.headline,
          intro: p.intro,
          slotLengthMins: p.slotLengthMins,
          slotIntervalMins: p.slotIntervalMins,
          requiresApproval: p.requiresApproval,
          requiresPayment: p.requiresPayment,
          priceCents: p.priceCents,
          minNoticeHours: p.minNoticeHours,
          windowDays: p.windowDays,
          availDays: Array.isArray(p.availDays) ? (p.availDays as number[]) : [],
          availStartTime: p.availStartTime,
          availEndTime: p.availEndTime,
          packageId: p.packageId,
          sessionType: p.sessionType,
          automations: p.automations.map(a => ({
            id: a.id,
            trigger: a.trigger,
            offsetMinutes: a.offsetMinutes,
            enabled: a.enabled,
            subject: a.subject,
            body: a.body,
          })),
        }))}
        embedForms={canManageForms ? embedForms.map(f => ({
          id: f.id,
          title: f.title,
          description: f.description,
          isActive: f.isActive,
          fieldCount: (Array.isArray(f.fields) ? f.fields.length : 0) + (Array.isArray(f.customFieldIds) ? f.customFieldIds.length : 0),
        })) : null}
      />
    </div>
  )
}
