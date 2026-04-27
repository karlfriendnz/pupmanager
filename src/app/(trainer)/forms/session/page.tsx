import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SessionFormsManager } from './session-forms-manager'
import type { Question } from './session-forms-manager'
import { FormsTabs } from '../forms-tabs'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session Forms' }

export default async function SessionFormsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/onboarding')

  const [forms, customFields] = await Promise.all([
    prisma.sessionForm.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { responses: true } } },
    }),
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
    }),
  ])

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Forms</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Build embeddable signup forms or session-report forms.
        </p>
      </div>
      <FormsTabs />
      <SessionFormsManager
        initialForms={forms.map(f => ({
          id: f.id,
          name: f.name,
          description: f.description,
          introText: f.introText,
          closingText: f.closingText,
          questions: Array.isArray(f.questions) ? f.questions as unknown as Question[] : [],
          responses: f._count.responses,
        }))}
        customFields={customFields.map(f => ({
          id: f.id,
          label: f.label,
          type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
          appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
          category: f.category,
        }))}
      />
    </div>
  )
}
