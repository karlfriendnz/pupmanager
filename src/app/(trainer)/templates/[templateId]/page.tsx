import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { ArrowLeft, Edit2 } from 'lucide-react'
import { ApplyTemplateModal } from './apply-template-modal'
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
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link href="/templates" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to templates
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{template.name}</h1>
          {template.description && <p className="text-slate-500 text-sm mt-1">{template.description}</p>}
          <p className="text-xs text-slate-400 mt-1">{template.tasks.length} tasks</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link href={`/templates/${template.id}/edit`}>
            <Button variant="secondary" size="sm"><Edit2 className="h-4 w-4" />Edit</Button>
          </Link>
          <ApplyTemplateModal templateId={template.id} templateName={template.name} clients={clients} />
        </div>
      </div>

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
  )
}
