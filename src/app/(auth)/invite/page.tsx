import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { AcceptInviteButton } from './accept-invite-button'

export const metadata: Metadata = { title: 'Accept your invitation — PupManager' }

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
    select: { name: true },
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Welcome to PupManager</h1>
        {user?.name && (
          <p className="mt-1 text-sm text-slate-500">Hi {user.name}, your account is ready.</p>
        )}
      </div>
      <Card>
        <CardBody className="pt-6 flex flex-col gap-4 text-sm text-slate-600">
          <p>Your trainer has set up an account for you. Click below to accept your invitation and receive a sign-in link.</p>
          <AcceptInviteButton token={token} email={email} />
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
