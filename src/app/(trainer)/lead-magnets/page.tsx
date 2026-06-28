import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { ensureTrainerSlug } from '@/lib/slug'
import { PageHeader } from '@/components/shared/page-header'
import { LeadMagnetsManager } from './lead-magnets-manager'

export const metadata: Metadata = { title: 'Lead magnets' }

export default async function LeadMagnetsPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!(await hasAddon(ctx.companyId, 'leadmagnets'))) redirect('/settings?tab=addons')

  const slug = (await ensureTrainerSlug(ctx.companyId)) ?? ''

  const [branding, magnets, subscribers, subscriberCount] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: ctx.companyId },
      select: { businessName: true, logoUrl: true, emailAccentColor: true },
    }),
    prisma.leadMagnet.findMany({
      where: { trainerId: ctx.companyId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { subscribers: true } } },
    }),
    prisma.subscriber.findMany({
      where: { trainerId: ctx.companyId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, email: true, name: true, status: true, createdAt: true,
        sourceLeadMagnet: { select: { title: true } },
      },
    }),
    prisma.subscriber.count({ where: { trainerId: ctx.companyId, status: 'SUBSCRIBED' } }),
  ])

  return (
    <>
      <PageHeader title="Lead magnets" subtitle="Free downloads that grow your mailing list" />
      <div className="p-4 md:p-8 w-full max-w-5xl mx-auto">
        <LeadMagnetsManager
          slug={slug}
          subscribedCount={subscriberCount}
          branding={{
            businessName: branding?.businessName || 'Your business',
            logoUrl: branding?.logoUrl ?? null,
            accent: branding?.emailAccentColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(branding.emailAccentColor) ? branding.emailAccentColor : '#0d9488',
          }}
          initialMagnets={magnets.map((m) => ({
            id: m.id,
            slug: m.slug,
            title: m.title,
            description: m.description,
            headline: m.headline,
            intro: m.intro,
            layout: m.layout,
            imageUrl: m.imageUrl,
            accentColor: m.accentColor,
            showHeader: m.showHeader,
            showTitle: m.showTitle,
            showFieldLabels: m.showFieldLabels,
            fileUrl: m.fileUrl,
            fileName: m.fileName,
            fileSizeBytes: m.fileSizeBytes,
            emailSubject: m.emailSubject,
            emailIntro: m.emailIntro,
            thankYouTitle: m.thankYouTitle,
            thankYouMessage: m.thankYouMessage,
            isActive: m.isActive,
            subscriberCount: m._count.subscribers,
          }))}
          initialSubscribers={subscribers.map((s) => ({
            id: s.id,
            email: s.email,
            name: s.name,
            status: s.status,
            createdAt: s.createdAt.toISOString(),
            source: s.sourceLeadMagnet?.title ?? null,
          }))}
        />
      </div>
    </>
  )
}
