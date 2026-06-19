import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { fetchBookingSlots } from '@/lib/booking-slots'
import { bookingConfig } from '@/lib/booking-page'
import { BookingFlow } from '../booking-flow'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; pageSlug: string }>
}): Promise<Metadata> {
  const { slug, pageSlug } = await params
  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: { businessName: true, bookingPages: { where: { slug: pageSlug }, select: { name: true } } },
  })
  const page = trainer?.bookingPages[0]
  return { title: trainer ? `${page?.name ?? 'Book'} — ${trainer.businessName}` : 'Book a session' }
}

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ slug: string; pageSlug: string }>
}) {
  const { slug, pageSlug } = await params

  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      user: { select: { timezone: true } },
      bookingPages: { where: { slug: pageSlug } },
    },
  })
  if (!trainer) notFound()
  const page = trainer.bookingPages[0]
  if (!page) notFound()

  const accent = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor) ? trainer.emailAccentColor : null
  const businessName = trainer.businessName || 'your trainer'

  // Is the visitor already a client of this trainer? Then they book as
  // themselves (no contact form) and honour the page's approval setting.
  const session = await auth()
  const client = session?.user?.id
    ? await prisma.clientProfile.findFirst({
        where: { userId: session.user.id, trainerId: trainer.id },
        select: { id: true, user: { select: { name: true } } },
      })
    : null

  const pkg = page.packageId
    ? await prisma.package.findFirst({
        where: { id: page.packageId, trainerId: trainer.id },
        select: { name: true, sessionCount: true, weeksBetween: true, durationMins: true },
      })
    : null

  const days = page.enabled ? await fetchBookingSlots(trainer.id, bookingConfig(page, trainer.user.timezone)) : []

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-4 py-10 sm:py-16">
      <div className="relative mx-auto flex w-full max-w-xl flex-col items-center">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {trainer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={trainer.logoUrl} alt={businessName} className="h-20 w-auto max-w-[280px] object-contain" />
          ) : (
            <div
              className="flex h-20 w-20 items-center justify-center rounded-3xl text-3xl font-bold text-white shadow-md"
              style={{ background: accent ?? 'var(--pm-brand-600)' }}
            >
              {businessName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              {page.headline?.trim() || page.name || `Book a session with ${businessName}`}
            </h1>
            {page.intro?.trim() && <p className="mt-1 text-sm text-slate-500">{page.intro.trim()}</p>}
          </div>
        </div>

        {!page.enabled ? (
          <div className="w-full rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-md shadow-slate-900/5">
            <p className="text-sm font-medium text-slate-600">This booking page isn’t open right now</p>
            <p className="mt-1 text-xs text-slate-400">Please contact {businessName} directly to arrange a session.</p>
          </div>
        ) : (
          <BookingFlow
            slug={slug}
            pageSlug={pageSlug}
            accentColor={accent}
            businessName={businessName}
            days={days}
            requiresApproval={page.requiresApproval}
            knownClientName={client?.user?.name ?? null}
            isKnownClient={!!client}
            pkg={pkg ? { name: pkg.name, sessionCount: pkg.sessionCount, weeksBetween: pkg.weeksBetween, durationMins: pkg.durationMins } : null}
            slotLengthMins={page.slotLengthMins}
          />
        )}

        <p className="mt-6 text-[11px] uppercase tracking-wider text-slate-400">Powered by PupManager</p>
      </div>
    </div>
  )
}
