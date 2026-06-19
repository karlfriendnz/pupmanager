import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { prisma } from '@/lib/prisma'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const trainer = await prisma.trainerProfile.findUnique({ where: { slug }, select: { businessName: true } })
  return { title: trainer ? `Book a session — ${trainer.businessName}` : 'Book a session' }
}

// Directory of a trainer's booking pages. One enabled page → straight through;
// several → a chooser; none → a polite empty state. Keeps the short
// /c/<slug>/book link working however many pages exist.
export default async function BookingDirectoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      bookingPages: {
        where: { enabled: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { slug: true, name: true, headline: true, intro: true },
      },
    },
  })
  if (!trainer) notFound()

  const pages = trainer.bookingPages
  if (pages.length === 1) redirect(`/c/${slug}/book/${pages[0].slug}`)

  const accent = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor) ? trainer.emailAccentColor : null
  const businessName = trainer.businessName || 'your trainer'

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
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Book with {businessName}</h1>
        </div>

        {pages.length === 0 ? (
          <div className="w-full rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-md shadow-slate-900/5">
            <p className="text-sm font-medium text-slate-600">Online booking isn’t open right now</p>
            <p className="mt-1 text-xs text-slate-400">Please contact {businessName} directly to arrange a session.</p>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            {pages.map(p => (
              <Link
                key={p.slug}
                href={`/c/${slug}/book/${p.slug}`}
                className="group flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: accent ?? 'var(--pm-brand-600)' }}
                >
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{p.headline?.trim() || p.name}</p>
                  {p.intro?.trim() && <p className="truncate text-sm text-slate-500">{p.intro.trim()}</p>}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
              </Link>
            ))}
          </div>
        )}

        <p className="mt-6 text-[11px] uppercase tracking-wider text-slate-400">Powered by PupManager</p>
      </div>
    </div>
  )
}
