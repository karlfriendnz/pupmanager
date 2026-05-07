import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { TemplateBuilderForm } from '../../template-builder-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit Template' }

export default async function EditTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { templateId } = await params

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const template = await prisma.trainingTemplate.findFirst({
    where: { id: templateId, trainerId },
    include: { tasks: { orderBy: [{ dayOffset: 'asc' }, { order: 'asc' }] } },
  })
  if (!template) notFound()

  const defaultValues = {
    name: template.name,
    description: template.description ?? '',
    tasks: template.tasks.map(t => ({
      dayOffset: t.dayOffset,
      title: t.title,
      description: t.description ?? '',
      repetitions: t.repetitions ?? ('' as const),
      videoUrl: t.videoUrl ?? '',
      order: t.order,
    })),
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link href={`/templates/${template.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to template
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Edit template</h1>
      <TemplateBuilderForm templateId={template.id} defaultValues={defaultValues} />
    </div>
  )
}
