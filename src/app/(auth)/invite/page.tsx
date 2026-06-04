import type { Metadata } from 'next'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { InviteFlow } from './invite-flow'

export const metadata: Metadata = { title: 'Accept your invitation — PupManager' }

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function formatList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>
}) {
  const { token, email } = await searchParams

  if (!token || !email) {
    return <InvalidInvite reason="Invalid invitation link." />
  }

  const record = await prisma.verificationToken.findUnique({
    where: { token },
  })

  if (!record || record.identifier !== email) {
    return <InvalidInvite reason="This invitation link is invalid." />
  }

  if (record.expires < new Date()) {
    return <InvalidInvite reason="This invitation link has expired. Ask your trainer to send a new one." />
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      name: true,
      role: true,
      // Resolve the trainer who invited this client so the page wears their
      // brand (logo / accent / business name), mirroring the trainer-branded
      // invite email + /verify-email screen for a consistent hand-off.
      clientProfiles: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          dog: { select: { name: true } },
          dogs: { select: { name: true } },
          trainer: {
            select: {
              businessName: true,
              logoUrl: true,
              emailAccentColor: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  // Invited team members are TRAINER users and land on the trainer dashboard;
  // client invites end on the "get the app" screen.
  const isClient = user?.role !== 'TRAINER'
  const callbackUrl = isClient ? '/home' : '/dashboard'

  const profile = user?.clientProfiles?.[0] ?? null
  const trainer = profile?.trainer ?? null
  const branded = isClient && !!trainer

  const accent = trainer?.emailAccentColor && HEX.test(trainer.emailAccentColor)
    ? trainer.emailAccentColor
    : null

  const firstName = user?.name?.trim().split(/\s+/)[0]
  const greetName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : null

  const trainerLabel = trainer?.user?.name?.trim() || trainer?.businessName || null
  const businessName = trainer?.businessName ?? null

  const dogNames = profile
    ? [profile.dog?.name, ...profile.dogs.map((d) => d.name)].filter((n): n is string => !!n)
    : []
  const dogList = formatList(dogNames) || null

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        {branded && trainer?.logoUrl ? (
          // Trainer logos may be non-square wordmarks — preserve aspect,
          // just bound the height. (matches /verify-email treatment)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trainer.logoUrl}
            alt={businessName ?? 'Logo'}
            className="mx-auto mb-3 h-20 w-auto max-w-[280px] object-contain"
          />
        ) : branded && businessName ? (
          <div
            className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-3xl text-3xl font-bold text-white shadow-md"
            style={{ background: accent ?? 'var(--pm-brand-600)' }}
          >
            {businessName.charAt(0).toUpperCase()}
          </div>
        ) : (
          <Image
            src="/logo.png"
            alt="PupManager"
            width={64}
            height={64}
            className="mx-auto mb-3 rounded-2xl shadow-md"
          />
        )}

        {branded && businessName && (
          <p
            className="text-sm font-semibold"
            style={{ color: accent ?? 'var(--pm-brand-600)' }}
          >
            {businessName}
          </p>
        )}

        <h1 className="mt-1 text-2xl font-bold text-slate-900">
          {greetName ? `Welcome, ${greetName}` : 'Welcome'}
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          {branded
            ? trainerLabel
              ? dogList
                ? `${trainerLabel} has set up a training space for ${dogList}.`
                : `${trainerLabel} has set up your training space.`
              : dogList
                ? `Your trainer has set up a training space for ${dogList}.`
                : 'Your trainer has set up your training space.'
            : isClient
              ? 'Your account is ready.'
              : "You've been invited to join a training team."}
        </p>
      </div>

      <Card>
        <CardBody className="pt-6 flex flex-col gap-4 text-sm text-slate-600">
          <p>
            {branded && dogList
              ? `Set a password to finish setting up your account and follow ${dogList}'s training, message your trainer, and see every session.`
              : 'Set a password to finish setting up your account — you’ll use it to sign in here and in the app.'}
          </p>
          <InviteFlow
            token={token}
            email={email}
            accentColor={accent}
            ctaLabel={businessName ? `Join ${businessName}` : 'Create my account'}
            callbackUrl={callbackUrl}
          />
        </CardBody>
      </Card>
    </div>
  )
}

function InvalidInvite({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-3xl">
          ⚠️
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Invalid invitation</h1>
        <p className="mt-1 text-sm text-slate-500">{reason}</p>
      </div>
    </div>
  )
}
