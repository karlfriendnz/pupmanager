import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { buildLinkButtons, buildSocialLinks, type LinkButtonType } from '@/lib/link-page'
import { LinkPageView } from './link-page-view'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const DEFAULT_ACCENT = 'var(--pm-brand-600)'

function PoweredBy({ onDark = false }: { onDark?: boolean }) {
  return (
    <p className={`pb-8 text-center text-[11px] uppercase tracking-wide ${onDark ? 'text-white/70' : 'text-slate-400'}`}>
      Powered by{' '}
      <a
        href="https://pupmanager.com"
        target="_blank"
        rel="noopener noreferrer"
        className={`font-semibold hover:underline ${onDark ? 'text-white/90' : 'text-slate-500'}`}
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
      instagram: lp.instagram,
      facebook: lp.facebook,
      tiktok: lp.tiktok,
      links: lp.links.map((l) => ({
        id: l.id,
        type: l.type as LinkButtonType,
        label: l.label,
        url: l.url,
        targetId: l.targetId,
        imageUrl: l.imageUrl,
        bgColor: l.bgColor,
        textColor: l.textColor,
      })),
    },
    {
      slug,
      website: trainer.website,
      publicEmail: trainer.publicEmail,
      phone: trainer.phone,
      showPhoneToClients: trainer.showPhoneToClients,
    },
  )
  const socials = buildSocialLinks({
    instagram: lp.instagram,
    facebook: lp.facebook,
    tiktok: lp.tiktok,
  })
  const onDark = Boolean(lp.backgroundUrl)

  return (
    <main className={`flex min-h-screen flex-col ${onDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
      <div className="flex-1">
        <LinkPageView
          businessName={trainer.businessName || 'Your trainer'}
          avatarUrl={trainer.iconUrl || trainer.logoUrl || null}
          headline={lp.headline}
          bio={lp.bio}
          buttons={buttons}
          socials={socials}
          socialsLabel={lp.socialsLabel}
          backgroundUrl={lp.backgroundUrl}
          font={lp.font}
          accent={accent}
        />
      </div>
      <PoweredBy onDark={onDark} />
    </main>
  )
}
