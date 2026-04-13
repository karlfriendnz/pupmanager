import { prisma } from '@/lib/prisma'
import { PublicFormView } from './public-form-view'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ formId: string }> }): Promise<Metadata> {
  const { formId } = await params
  const form = await prisma.intakeForm.findUnique({ where: { id: formId }, select: { name: true } })
  return { title: form?.name ?? 'Enquiry Form' }
}

export default async function PublicFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params

  const form = await prisma.intakeForm.findUnique({
    where: { id: formId, isPublished: true },
    include: {
      sections: {
        orderBy: { order: 'asc' },
        include: { fields: { orderBy: { order: 'asc' } } },
      },
      trainer: { select: { businessName: true, logoUrl: true } },
    },
  })

  if (!form) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center text-slate-500">
          <p className="text-lg font-semibold">This form is not available.</p>
          <p className="text-sm mt-1">It may have been removed or is not yet published.</p>
        </div>
      </div>
    )
  }

  return <PublicFormView form={form} />
}
