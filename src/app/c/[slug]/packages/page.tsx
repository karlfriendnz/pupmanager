import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Ticket, Check, Lock, ArrowRight } from 'lucide-react'

import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { loadPublishedMemberships } from '@/lib/client-memberships'
import { lockedCopy } from '@/lib/membership-card-action'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '@/lib/feature-flags'
import { RichText } from '@/components/shared/rich-text'
import { formatMoney } from '@/lib/money'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// The public shop window for a trainer's packages — the half of "show these on
// the website and in the booking platform" that did not exist. /c/<slug> is a
// sign-in page and /c/<slug>/book is a booking flow; neither of them ever said
// what a trainer sells.
//
// Nobody is signed in here, so `loadPublishedMemberships` is called with NO
// client. That is not a limitation, it is the point: with no client, nobody
// holds any achievement and nobody has been invited, so a gated package comes
// back locked. A stranger sees exactly what a client who hasn't earned it sees,
// and a package the trainer chose to hide when locked is absent entirely —
// the same rule, applied by the same function, with no second code path that
// could disagree with the signed-in one.
//
// There is no Buy button. Everything routes through sign-in, because a purchase
// has to belong to somebody.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: { businessName: true },
  })
  return {
    title: trainer ? `Packages — ${trainer.businessName}` : 'Packages',
    description: trainer ? `Training packages from ${trainer.businessName}.` : undefined,
  }
}

export default async function PublicPackagesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      id: true, businessName: true, logoUrl: true, emailAccentColor: true, payoutCurrency: true,
    },
  })
  if (!trainer) notFound()

  const accent = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor)
    ? trainer.emailAccentColor
    : null
  const businessName = trainer.businessName || 'Training'
  const currency = trainer.payoutCurrency ?? 'nzd'

  // Same two gates the signed-in storefront honours: the add-on, and the
  // kill-switch. A trainer with packages switched off has no shop window.
  const memberships = PACKAGES_HIDDEN_FROM_CLIENTS || !(await hasAddon(trainer.id, 'memberships'))
    ? []
    : await loadPublishedMemberships(trainer.id)

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 flex flex-col items-center gap-3 text-center">
          {trainer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={trainer.logoUrl} alt={businessName} className="h-16 w-auto max-w-[240px] object-contain" />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-3xl text-2xl font-bold text-white shadow-md"
              style={{ background: accent ?? 'var(--pm-brand-600)' }}
            >
              {businessName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{businessName}</h1>
            <p className="mt-1 text-sm text-slate-500">Training packages</p>
          </div>
        </header>

        {memberships.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">No packages are on offer right now.</p>
            <Link
              href={`/c/${slug}`}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium"
              style={{ color: accent ?? 'var(--pm-brand-600)' }}
            >
              Sign in <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {memberships.map(m => {
              const bg = m.bgColor ?? '#ffffff'
              const header = m.headerColor ?? '#0f172a'
              const text = m.textColor ?? '#64748b'
              const featured = m.featuredColor ?? accent ?? '#7c3aed'
              const locked = !m.eligible
              const price = m.interval
                ? `${formatMoney(m.priceCents, currency)} / ${m.interval.toLowerCase()}`
                : formatMoney(m.priceCents, currency)

              return (
                <article
                  key={m.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm"
                  style={{ backgroundColor: bg }}
                >
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.imageUrl}
                      alt=""
                      className={`h-40 w-full object-cover ${locked ? 'opacity-60 grayscale' : ''}`}
                    />
                  )}
                  <div className={`p-5 ${locked ? 'opacity-75' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: header }}>
                          <Ticket className="h-5 w-5 shrink-0" style={{ color: featured }} />
                          {m.name}
                        </h2>
                        <div className="mt-1" style={{ color: text }}>
                          <RichText html={m.description} className="text-sm" />
                        </div>
                      </div>
                      {m.priceCents > 0 && (
                        <span className="whitespace-nowrap text-lg font-bold" style={{ color: featured }}>
                          {price}
                        </span>
                      )}
                    </div>

                    {m.items.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-2.5">
                        {m.items.map((it, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            {it.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={it.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-black/10 object-cover" />
                            ) : (
                              <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: featured }} />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm" style={{ color: header }}>
                                {it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}
                              </p>
                              {it.description && (
                                <div style={{ color: text }}>
                                  <RichText html={it.description} className="text-xs" />
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {locked ? (
                      // Shown rather than sold. A locked rung on a public page
                      // is doing marketing work — it says there is more here
                      // than the entry level.
                      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
                        <p className="text-sm text-slate-600">
                          {/* Same sentence a signed-in client sees, from the
                              same function — except invite-only, which names
                              the business because a stranger has no "your
                              trainer" yet. */}
                          {m.lockedReason === 'INVITE_ONLY'
                            ? `${businessName} invites people to this one.`
                            : lockedCopy(m)}
                        </p>
                      </div>
                    ) : (
                      <Link
                        href={`/c/${slug}`}
                        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl font-semibold text-white hover:opacity-90"
                        style={{ backgroundColor: featured }}
                      >
                        {m.buttonText?.trim() || 'Sign in to join'}
                        <ArrowRight className="h-4 w-4" strokeWidth={2} />
                      </Link>
                    )}
                  </div>
                </article>
              )
            })}

            <p className="mt-2 text-center text-sm text-slate-500">
              New here?{' '}
              <Link href={`/c/${slug}/join`} className="font-medium" style={{ color: accent ?? 'var(--pm-brand-600)' }}>
                Create an account
              </Link>
            </p>
          </div>
        )}

        <p className="mt-8 text-center text-[11px] uppercase tracking-wider text-slate-400">
          Powered by PupManager
        </p>
      </div>
    </div>
  )
}
