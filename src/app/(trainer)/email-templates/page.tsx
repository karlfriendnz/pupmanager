import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/shared/page-header'
import { EmailTemplatesPanel } from '../settings/email-templates-panel'

export const metadata: Metadata = { title: 'Email templates' }

// Email templates — moved out of Settings into the Communication nav group.
// Trainer-owned reusable templates the composer pulls from, plus the pinned
// client-invite template (backed by TrainerProfile.inviteTemplate).
export default async function EmailTemplatesPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!can('settings.edit', ctx.role, ctx.permissions)) redirect('/dashboard')

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { inviteTemplate: true },
  })

  return (
    <>
      <PageHeader title="Email templates" subtitle="Reusable templates for client emails" />
      <div className="p-4 md:p-8 w-full max-w-3xl mx-auto">
        <EmailTemplatesPanel inviteTemplate={trainer?.inviteTemplate ?? null} />
      </div>
    </>
  )
}
