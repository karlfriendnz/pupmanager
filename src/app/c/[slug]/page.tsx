import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { ClientLoginForm } from './client-login-form'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: { businessName: true },
  })
  return { title: trainer ? `Sign in — ${trainer.businessName}` : 'Sign in' }
}

export default async function TrainerClientLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      website: true,
      publicEmail: true,
    },
  })
  if (!trainer) notFound()

  const accent = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor)
    ? trainer.emailAccentColor
    : null
  const businessName = trainer.businessName || 'your trainer'

  // "Not a client yet?" points at the trainer's own website if set, else a
  // mailto to their public email — whichever exists.
  const website = trainer.website?.trim()
  const contactHref = website
    ? (/^https?:\/\//i.test(website) ? website : `https://${website}`)
    : trainer.publicEmail
      ? `mailto:${trainer.publicEmail}`
      : null

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-4 py-10 sm:py-16">
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {trainer.logoUrl ? (
            // Logos may be non-square wordmarks — preserve aspect, bound height.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={trainer.logoUrl}
              alt={businessName}
              className="h-20 w-auto max-w-[280px] object-contain"
            />
          ) : (
            <div
              className="flex h-20 w-20 items-center justify-center rounded-3xl text-3xl font-bold text-white shadow-md"
              style={{ background: accent ?? 'var(--pm-brand-600)' }}
            >
              {businessName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{businessName}</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to your training space</p>
          </div>
        </div>

        <Card className="w-full border-slate-100/80 shadow-md shadow-slate-900/5">
          <CardBody className="pt-6">
            <ClientLoginForm
              accentColor={accent}
              businessName={businessName}
              contactHref={contactHref}
            />
          </CardBody>
        </Card>

        <p className="mt-6 text-[11px] uppercase tracking-wider text-slate-400">
          Powered by PupManager
        </p>
      </div>
    </div>
  )
}
