import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { ensureTrainerSlug } from '@/lib/slug'
import { WebsiteIntegrationPanel } from '../settings/website-integration-panel'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Website' }

// Everything a trainer hooks into their own website — branded client-login
// link, Calendly-style booking pages (+ automations), and lead-capture embed
// forms. A top-level nav item; gated by settings.edit (same as the old tab).
export default async function WebsitePage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!can('settings.edit', ctx.role, ctx.permissions)) redirect('/dashboard')
  const canManageForms = can('forms.manage', ctx.role, ctx.permissions)

  const slug = await ensureTrainerSlug(ctx.companyId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'

  const [bookingPages, embedForms] = await Promise.all([
    prisma.bookingPage.findMany({
      where: { trainerId: ctx.companyId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { automations: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
    }),
    canManageForms
      ? prisma.embedForm.findMany({ where: { trainerId: ctx.companyId }, orderBy: { createdAt: 'desc' } })
      : Promise.resolve([]),
  ])

  return (
    <>
      <PageHeader title="Website" />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-[872px] mx-auto">
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
    </>
  )
}
