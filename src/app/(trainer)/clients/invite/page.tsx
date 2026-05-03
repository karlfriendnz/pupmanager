import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { InviteClientForm } from './invite-client-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Invite client' }

export default async function InviteClientPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { businessName: true, inviteTemplate: true },
  })

  const defaultTemplate =
    trainerProfile?.inviteTemplate ??
    `Hi {{clientName}},

I'd like to invite you to join PupManager — an app I use to assign daily training exercises for {{dogName}} and track your progress between our sessions.

Click the link below to create your account and get started!

Looking forward to working with you,
${trainerProfile?.businessName ?? 'Your Trainer'}`

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Invite a new client</h1>
        <p className="text-sm text-slate-500 mt-1">
          Customise the invitation email before sending
        </p>
      </div>
      <InviteClientForm defaultTemplate={defaultTemplate} />
    </div>
  )
}
