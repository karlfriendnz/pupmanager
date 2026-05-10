import type { Metadata } from 'next'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Check your email' }

// /verify-email is the post-magic-link landing page ("we've sent you
// a login link"). The trainer-branded magic-link email lands the
// client back on app.pupmanager.com, but anyone hitting THIS page
// before they tap the email link should still see who the email is
// from. When ?email=… is provided we resolve the user's trainer and
// brand the page with their logo + business name. No email param —
// or no trainer match — falls back to PupManager.
//
// Brand-on-trainer follows the same pattern as the actual
// magic-link email body (renderLoginLinkEmail) so the trainer's
// presence is consistent end-to-end.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams

  let trainerLogoUrl: string | null = null
  let trainerName: string | null = null

  if (email) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        clientProfile: {
          select: {
            trainer: { select: { businessName: true, logoUrl: true } },
          },
        },
        trainerProfile: { select: { businessName: true, logoUrl: true } },
      },
    })
    const t = user?.clientProfile?.trainer ?? user?.trainerProfile ?? null
    if (t) {
      trainerLogoUrl = t.logoUrl
      trainerName = t.businessName
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        {trainerLogoUrl ? (
          // No crop / no border — trainer logos may be wordmarks or
          // non-square; preserve aspect, bound the height.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trainerLogoUrl}
            alt={trainerName ?? 'Logo'}
            className="mx-auto mb-4 h-24 w-auto max-w-[280px] object-contain"
          />
        ) : (
          <Image
            src="/logo.png"
            alt="PupManager"
            width={64}
            height={64}
            className="mx-auto mb-4 rounded-2xl shadow-md"
          />
        )}
        {trainerName && (
          <p className="text-sm font-medium text-blue-600 mb-2">{trainerName}</p>
        )}
        <h1 className="text-2xl font-bold text-slate-900">Check your email</h1>
        <p className="mt-1 text-sm text-slate-500">
          {trainerName
            ? `We've sent you a sign-in link from ${trainerName}.`
            : "We've sent you a login link"}
        </p>
      </div>
      <Card>
        <CardBody className="pt-6 text-center text-sm text-slate-600 flex flex-col gap-3">
          <p>
            {trainerName
              ? `Click the link in the email to sign in to ${trainerName}.`
              : 'Click the link in your email to sign in to PupManager.'}
          </p>
          <p className="text-slate-400 text-xs">
            The link expires in 15 minutes. Check your spam folder if you don&apos;t see it.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
