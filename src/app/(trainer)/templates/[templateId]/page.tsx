import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Edit2 } from 'lucide-react'
import { ApplyTemplateModal } from './apply-template-modal'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Template' }

export default async function TemplateDetailPage({ params }: { params: Promise<{ templateId: string }> }) {
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

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId },
    include: { user: { select: { name: true, email: true } }, dog: { select: { name: true } } },
  })

  return (
    <>
      <PageHeader
        title={template.name}
        subtitle={`${template.tasks.length} tasks`}
        back={{ href: '/templates', label: 'Back to templates' }}
        actions={
          <>
            <Link href={`/templates/${template.id}/edit`}>
              <Button variant="secondary" size="sm">
                <Edit2 className="h-4 w-4" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            </Link>
            <ApplyTemplateModal templateId={template.id} templateName={template.name} clients={clients} />
          </>
        }
      />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-4xl xl:max-w-6xl mx-auto">

      {template.description && (
        <p className="text-slate-500 text-sm mb-6">{template.description}</p>
      )}

      <div className="flex flex-col gap-2">
        {template.tasks.map(task => (
          <Card key={task.id}>
            <CardBody className="pt-3 pb-3">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 h-7 w-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                  {task.dayOffset}
                </span>
                <div>
                  <p className="font-medium text-slate-900 text-sm">{task.title}</p>
                  {task.repetitions && <p className="text-xs text-slate-500">{task.repetitions} reps</p>}
                  {task.description && <p className="text-sm text-slate-600 mt-0.5">{task.description}</p>}
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      </div>
    </>
  )
}
