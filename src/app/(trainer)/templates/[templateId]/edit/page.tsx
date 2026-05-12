import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TemplateBuilderForm } from '../../template-builder-form'
import { PageHeader } from '@/components/shared/page-header'
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
    <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
      <PageHeader
        title="Edit template"
        back={{ href: `/templates/${template.id}`, label: 'Back to template' }}
      />
      <TemplateBuilderForm templateId={template.id} defaultValues={defaultValues} />
    </div>
  )
}
