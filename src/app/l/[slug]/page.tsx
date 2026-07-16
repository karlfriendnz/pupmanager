import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { buildLinkButtons } from '@/lib/link-page'
import { LinkPageView } from './link-page-view'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const DEFAULT_ACCENT = 'var(--pm-brand-600)'

function PoweredBy() {
  return (
    <p className="pb-8 text-center text-[11px] uppercase tracking-wide text-slate-400">
      Powered by{' '}
      <a
        href="https://pupmanager.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-slate-500 hover:underline"
      >
        PupManager
      </a>
    </p>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: { businessName: true, linkPage: { select: { headline: true, bio: true } } },
  })
  if (!trainer || !trainer.linkPage) return { title: 'Link in bio' }
  const title = trainer.businessName || 'Link in bio'
  const description = trainer.linkPage.headline || trainer.linkPage.bio || `Book with ${title} and find all their links.`
  return {
    title,
    description,
    openGraph: { title, description },
  }
}

export default async function LinkInBioPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      businessName: true,
      logoUrl: true,
      iconUrl: true,
      emailAccentColor: true,
      website: true,
      publicEmail: true,
      phone: true,
      showPhoneToClients: true,
      linkPage: { include: { links: { orderBy: { order: 'asc' } } } },
    },
  })

  if (!trainer || !trainer.linkPage) notFound()
  if (!(await hasAddon(trainer.id, 'instagram'))) notFound()

  const accent =
    trainer.emailAccentColor && HEX.test(trainer.emailAccentColor)
      ? trainer.emailAccentColor
      : DEFAULT_ACCENT

  const lp = trainer.linkPage
  const buttons = buildLinkButtons(
    {
      headline: lp.headline,
      bio: lp.bio,
      showBooking: lp.showBooking,
      showWebsite: lp.showWebsite,
      showContact: lp.showContact,
      instagram: lp.instagram,
      facebook: lp.facebook,
      tiktok: lp.tiktok,
      links: lp.links.map((l) => ({ label: l.label, url: l.url })),
    },
    {
      slug,
      website: trainer.website,
      publicEmail: trainer.publicEmail,
      phone: trainer.phone,
      showPhoneToClients: trainer.showPhoneToClients,
    },
  )

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <div className="flex-1">
        <LinkPageView
          businessName={trainer.businessName || 'Your trainer'}
          avatarUrl={trainer.iconUrl || trainer.logoUrl || null}
          headline={lp.headline}
          bio={lp.bio}
          buttons={buttons}
          accent={accent}
        />
      </div>
      <PoweredBy />
    </main>
  )
}
