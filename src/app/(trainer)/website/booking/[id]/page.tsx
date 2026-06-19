import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { ensureTrainerSlug } from '@/lib/slug'
import { BookingPageEditor } from '../../../settings/booking-page-editor'
import type { BookingPageRow } from '../../../settings/booking-pages-manager'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Booking page' }

export default async function BookingPageEditRoute({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!can('settings.edit', ctx.role, ctx.permissions)) redirect('/dashboard')

  const { id } = await params
  const page = await prisma.bookingPage.findFirst({
    where: { id, trainerId: ctx.companyId },
    include: { automations: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
  })
  if (!page) notFound()

  const [packages, slug] = await Promise.all([
    prisma.package.findMany({
      where: { trainerId: ctx.companyId, isGroup: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, durationMins: true, sessionCount: true },
    }),
    ensureTrainerSlug(ctx.companyId),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'
  const publicUrlBase = slug ? `${appUrl.replace(/\/$/, '')}/c/${slug}/book` : null

  const row: BookingPageRow = {
    id: page.id,
    name: page.name,
    slug: page.slug,
    enabled: page.enabled,
    headline: page.headline,
    intro: page.intro,
    slotLengthMins: page.slotLengthMins,
    slotIntervalMins: page.slotIntervalMins,
    requiresApproval: page.requiresApproval,
    requiresPayment: page.requiresPayment,
    priceCents: page.priceCents,
    minNoticeHours: page.minNoticeHours,
    windowDays: page.windowDays,
    availDays: Array.isArray(page.availDays) ? (page.availDays as number[]) : [],
    availStartTime: page.availStartTime,
    availEndTime: page.availEndTime,
    packageId: page.packageId,
    sessionType: page.sessionType,
    automations: page.automations.map(a => ({
      id: a.id,
      trigger: a.trigger,
      offsetMinutes: a.offsetMinutes,
      enabled: a.enabled,
      subject: a.subject,
      body: a.body,
    })),
  }

  return (
    <>
      <PageHeader title={page.name} back={{ href: '/website', label: 'Website' }} />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-[872px] mx-auto">
        <BookingPageEditor page={row} packages={packages} publicUrlBase={publicUrlBase} />
      </div>
    </>
  )
}
