import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Plus, ClipboardList, Users, ExternalLink } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Intake Forms' }

export default async function FormsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainerProfile) redirect('/onboarding')

  const forms = await prisma.intakeForm.findMany({
    where: { trainerId: trainerProfile.id },
    include: { _count: { select: { submissions: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Intake Forms</h1>
          <p className="text-sm text-slate-500 mt-0.5">Capture leads from your website</p>
        </div>
        <Link href="/forms/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            New form
          </Button>
        </Link>
      </div>

      {forms.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-500">No forms yet</p>
          <p className="text-sm mt-1">Create an intake form and embed it on your website to capture leads.</p>
          <Link href="/forms/new" className="mt-4 inline-block">
            <Button size="sm"><Plus className="h-4 w-4" /> New form</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {forms.map(form => (
            <Card key={form.id}>
              <CardBody className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900 truncate">{form.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${form.isPublished ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {form.isPublished ? 'Live' : 'Draft'}
                      </span>
                    </div>
                    {form.description && <p className="text-sm text-slate-500 mt-0.5 truncate">{form.description}</p>}
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                      <Users className="h-3 w-3" /> {form._count.submissions} submission{form._count.submissions !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Link href={`/forms/${form.id}/leads`}>
                      <Button variant="secondary" size="sm">Leads</Button>
                    </Link>
                    <Link href={`/forms/${form.id}/edit`}>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </Link>
                    {form.isPublished && (
                      <a href={`/f/${form.id}`} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm"><ExternalLink className="h-4 w-4" /></Button>
                      </a>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
