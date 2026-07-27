import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { ClientSignupForm } from '@/app/(auth)/signup/client/client-signup-form'

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
  return { title: trainer ? `Join ${trainer.businessName}` : 'Create your account' }
}

// "A client should also be able to sign up from a trainer's website."
//
// /c/<slug> was sign-in only — a dog owner who did not have an account yet was
// told to email the business. This is the missing door, and because the trainer
// is implied by the URL there is nothing for the visitor to choose.
//
// It does NOT add them to the trainer's client list. A public link that wrote
// straight into a business record would let anyone put themselves on a
// trainer's books, so signing up here raises a join request (an Enquiry with
// source SELF_SIGNUP) that the trainer accepts from /enquiries with one tap.
export default async function TrainerJoinPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const trainer = await prisma.trainerProfile.findFirst({
    where: { slug, user: { deactivatedAt: null } },
    select: { id: true, businessName: true, logoUrl: true, slug: true, emailAccentColor: true },
  })
  if (!trainer) notFound()

  const accent = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor)
    ? trainer.emailAccentColor
    : null
  const businessName = trainer.businessName || 'your trainer'

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-4 py-10 sm:py-16">
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {trainer.logoUrl ? (
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
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Join {businessName}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Create your account and we&apos;ll ask them to add you.
            </p>
          </div>
        </div>

        <Card className="w-full border-slate-100/80 shadow-md shadow-slate-900/5">
          <CardBody className="pt-6">
            <ClientSignupForm
              lockedTrainer={{
                id: trainer.id,
                businessName: trainer.businessName,
                logoUrl: trainer.logoUrl,
                slug: trainer.slug,
              }}
              accentColor={accent}
            />
          </CardBody>
        </Card>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link
            href={`/c/${slug}`}
            className="font-medium hover:underline"
            style={accent ? { color: accent } : undefined}
          >
            Sign in
          </Link>
        </p>

        <p className="mt-6 text-[11px] uppercase tracking-wider text-slate-400">
          Powered by PupManager
        </p>
      </div>
    </div>
  )
}
