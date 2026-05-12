import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { InviteClientForm } from './invite-client-form'
import { PageHeader } from '@/components/shared/page-header'
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
    <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
      <PageHeader
        title="Invite a new client"
        back={{ href: '/clients', label: 'Back to clients' }}
      />
      <p className="text-sm text-slate-500 mb-6">
        Customise the invitation email before sending
      </p>
      <InviteClientForm defaultTemplate={defaultTemplate} />
    </div>
  )
}
