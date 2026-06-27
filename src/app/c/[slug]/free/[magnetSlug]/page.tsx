import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { PublicLeadMagnetForm } from './public-lead-magnet-form'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const DEFAULT_ACCENT = '#0d9488'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; magnetSlug: string }>
}): Promise<Metadata> {
  const { slug, magnetSlug } = await params
  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: { businessName: true, leadMagnets: { where: { slug: magnetSlug, isActive: true }, select: { title: true, description: true } } },
  })
  const m = trainer?.leadMagnets[0]
  if (!m || !trainer) return { title: 'Free download' }
  return {
    title: `${m.title} — ${trainer.businessName}`,
    description: m.description ?? `Get your free copy of ${m.title} from ${trainer.businessName}.`,
    openGraph: { title: m.title, description: m.description ?? undefined },
  }
}

export default async function PublicLeadMagnetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; magnetSlug: string }>
  searchParams: Promise<{ embed?: string }>
}) {
  const { slug, magnetSlug } = await params
  const { embed } = await searchParams
  const isEmbed = embed === '1'

  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      leadMagnets: { where: { slug: magnetSlug, isActive: true } },
    },
  })
  const magnet = trainer?.leadMagnets[0]
  if (!trainer || !magnet) notFound()
  if (!(await hasAddon(trainer.id, 'leadmagnets'))) notFound()

  const accent = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor) ? trainer.emailAccentColor : DEFAULT_ACCENT
  const business = trainer.businessName || 'Your trainer'

  return (
    <main className={isEmbed ? 'p-4' : 'min-h-screen bg-slate-50 px-4 py-10'}>
      <div className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div style={{ height: 4, background: accent }} />
          <div className="px-6 pt-6 text-center">
            {trainer.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={trainer.logoUrl} alt={business} className="mx-auto max-h-16 max-w-[220px] object-contain" />
            ) : (
              <div
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-white"
                style={{ background: accent }}
              >
                {business.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="mt-2 text-sm font-semibold text-slate-900">{business}</p>
          </div>

          <div className="px-6 pb-6 pt-4">
            <h1 className="text-xl font-bold leading-tight text-slate-900">{magnet.headline || magnet.title}</h1>
            {(magnet.intro || magnet.description) && (
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{magnet.intro || magnet.description}</p>
            )}

            <div className="mt-5">
              <PublicLeadMagnetForm
                slug={slug}
                magnetSlug={magnetSlug}
                consentText={magnet.consentText}
                accent={accent}
                thankYouTitle={magnet.thankYouTitle}
                thankYouMessage={magnet.thankYouMessage}
              />
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] uppercase tracking-wide text-slate-400">
          Powered by{' '}
          <a href="https://pupmanager.com" target="_blank" rel="noopener" className="font-semibold text-slate-500 hover:underline">
            PupManager
          </a>
        </p>
      </div>
    </main>
  )
}
