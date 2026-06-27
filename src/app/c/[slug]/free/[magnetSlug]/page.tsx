import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { PublicLeadMagnetForm } from './public-lead-magnet-form'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const DEFAULT_ACCENT = '#0d9488'

function PoweredBy() {
  return (
    <p className="mt-4 text-center text-[11px] uppercase tracking-wide text-slate-400">
      Powered by{' '}
      <a href="https://pupmanager.com" target="_blank" rel="noopener" className="font-semibold text-slate-500 hover:underline">PupManager</a>
    </p>
  )
}

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
  const headline = magnet.headline || magnet.title
  const intro = magnet.intro || magnet.description
  const hero = magnet.imageUrl

  const form = (
    <PublicLeadMagnetForm
      slug={slug}
      magnetSlug={magnetSlug}
      consentText={magnet.consentText}
      accent={accent}
      thankYouTitle={magnet.thankYouTitle}
      thankYouMessage={magnet.thankYouMessage}
    />
  )

  const logo = trainer.logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={trainer.logoUrl} alt={business} className="max-h-14 max-w-[200px] object-contain" />
    : <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-bold text-white" style={{ background: accent }}>{business.charAt(0).toUpperCase()}</div>

  const wrapClass = isEmbed ? 'p-3' : 'min-h-screen bg-slate-50 px-4 py-10'

  // ── Split: accent panel beside the form ───────────────────────────────────
  if (magnet.layout === 'split') {
    return (
      <main className={wrapClass}>
        <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm md:grid md:grid-cols-2">
          <div
            className="relative flex flex-col justify-center gap-3 p-8 text-white"
            style={hero
              ? { backgroundImage: `linear-gradient(150deg, ${accent}dd, ${shade(accent)}b3), url(${hero})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: `linear-gradient(150deg, ${accent}, ${shade(accent)})` }}
          >
            <span className="text-xs font-bold uppercase tracking-widest text-white/80">Free download</span>
            <h1 className="text-2xl font-bold leading-tight">{headline}</h1>
            {intro && <p className="text-sm leading-relaxed text-white/90">{intro}</p>}
            <div className="mt-2 text-sm font-medium text-white/80">{business}</div>
          </div>
          <div className="p-7">
            <div className="mb-4">{logo}</div>
            {form}
          </div>
        </div>
        {!isEmbed && <div className="mx-auto max-w-3xl"><PoweredBy /></div>}
      </main>
    )
  }

  // ── Spotlight: full accent background, floating form card ──────────────────
  if (magnet.layout === 'spotlight') {
    return (
      <main
        className={isEmbed ? 'p-3' : 'flex min-h-screen items-center justify-center px-4 py-10'}
        style={isEmbed ? undefined : (hero
          ? { backgroundImage: `linear-gradient(160deg, ${accent}d9, ${shade(accent)}cc), url(${hero})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: `linear-gradient(160deg, ${accent}, ${shade(accent)})` })}
      >
        <div className="w-full max-w-md">
          {!isEmbed && (
            <div className="mb-5 text-center text-white">
              <span className="text-xs font-bold uppercase tracking-widest text-white/80">Free download</span>
              <h1 className="mt-1 text-2xl font-bold leading-tight">{headline}</h1>
            </div>
          )}
          <div className="rounded-3xl bg-white p-6 shadow-xl">
            <div className="mb-3 text-center">{logo}</div>
            {isEmbed && <h1 className="mb-3 text-center text-xl font-bold text-slate-900">{headline}</h1>}
            {intro && <p className="mb-4 text-center text-sm text-slate-600">{intro}</p>}
            {form}
          </div>
          {!isEmbed && <PoweredBy />}
        </div>
      </main>
    )
  }

  // ── Minimal: bold headline, no photo ──────────────────────────────────────
  if (magnet.layout === 'minimal') {
    return (
      <main className={wrapClass}>
        <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-sm">
          <span className="inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide" style={{ background: tint(accent), color: accent }}>Free download</span>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight text-slate-900">{headline}</h1>
          {intro && <p className="mt-2 text-sm leading-relaxed text-slate-600">{intro}</p>}
          <div className="mt-5 text-left">{form}</div>
          <p className="mt-4 text-xs font-medium text-slate-400">{business}</p>
        </div>
        {!isEmbed && <div className="mx-auto max-w-md"><PoweredBy /></div>}
      </main>
    )
  }

  // ── Classic (default): accent bar + logo + centred form ───────────────────
  return (
    <main className={wrapClass}>
      <div className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          {hero ? (
            <div className="h-36 bg-cover bg-center" style={{ backgroundImage: `url(${hero})` }} />
          ) : (
            <div style={{ height: 4, background: accent }} />
          )}
          <div className={`px-6 text-center ${hero ? 'pt-0' : 'pt-6'}`}>
            <div className={`flex justify-center ${hero ? '-mt-8' : ''}`}>
              <span className={hero ? 'rounded-2xl bg-white p-1 shadow-sm' : ''}>{logo}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-900">{business}</p>
          </div>
          <div className="px-6 pb-6 pt-4">
            <h1 className="text-xl font-bold leading-tight text-slate-900">{headline}</h1>
            {intro && <p className="mt-2 text-sm leading-relaxed text-slate-600">{intro}</p>}
            <div className="mt-5">{form}</div>
          </div>
        </div>
        {!isEmbed && <PoweredBy />}
      </div>
    </main>
  )
}

// Darken a hex accent ~18% for gradient ends; falls back to the input on parse fail.
function shade(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = Math.max(0, ((n >> 16) & 255) - 40)
  const g = Math.max(0, ((n >> 8) & 255) - 40)
  const b = Math.max(0, (n & 255) - 40)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
// Very light tint of the accent for the "Free download" pill background.
function tint(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return '#ecfdf5'
  return `${hex}1a` // 10% alpha
}
