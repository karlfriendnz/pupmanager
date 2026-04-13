import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FormBuilder } from '../../form-builder'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit form' }

export default async function EditFormPage({ params }: { params: Promise<{ formId: string }> }) {
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
      sections: {
        orderBy: { order: 'asc' },
        include: { fields: { orderBy: { order: 'asc' } } },
      },
    },
  })
  if (!form) notFound()

  const defaultValues = {
    name: form.name,
    description: form.description ?? '',
    isPublished: form.isPublished,
    sections: form.sections.map(s => ({
      title: s.title,
      order: s.order,
      fields: s.fields.map(f => ({
        type: f.type as 'TEXT' | 'MULTIPLE_CHOICE' | 'DROPDOWN',
        label: f.label,
        required: f.required,
        options: Array.isArray(f.options) ? f.options as string[] : [],
        order: f.order,
      })),
    })),
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{form.name}</h1>
        <p className="text-sm text-slate-500 mt-0.5">Edit your intake form</p>
      </div>
      <FormBuilder
        formId={formId}
        defaultValues={defaultValues}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
      />
    </div>
  )
}
