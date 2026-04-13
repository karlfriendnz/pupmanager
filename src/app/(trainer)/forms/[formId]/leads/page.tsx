import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { LeadsDashboard } from './leads-dashboard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Leads' }

export default async function LeadsPage({ params }: { params: Promise<{ formId: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { formId } = await params

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainerProfile) redirect('/onboarding')

  const form = await prisma.intakeForm.findFirst({
    where: { id: formId, trainerId: trainerProfile.id },
    include: {
      sections: { orderBy: { order: 'asc' }, include: { fields: { orderBy: { order: 'asc' } } } },
      submissions: { orderBy: { submittedAt: 'desc' } },
    },
  })
  if (!form) notFound()

  const serialised = {
    id: form.id,
    sections: form.sections,
    submissions: form.submissions.map(s => ({
      ...s,
      submittedAt: s.submittedAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{form.name} — Leads</h1>
          <p className="text-sm text-slate-500 mt-0.5">{form.submissions.length} submission{form.submissions.length !== 1 ? 's' : ''}</p>
        </div>
        <a href={`/forms/${formId}/edit`} className="text-sm text-blue-600 hover:underline">Edit form</a>
      </div>
      <LeadsDashboard form={serialised} />
    </div>
  )
}
