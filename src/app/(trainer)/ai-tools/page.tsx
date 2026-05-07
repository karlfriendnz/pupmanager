import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { Sparkles, Wand2, BarChart2 } from 'lucide-react'
import { AIPlanGenerator } from './ai-plan-generator'
import { AIProgressSummary } from './ai-progress-summary'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'AI Tools' }

export default async function AIToolsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-6 w-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">AI Tools</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">AI-powered tools to help you plan and review client training</p>

      <div className="flex flex-col gap-8">
        {/* Plan Generator */}
        <Card>
          <CardBody className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Wand2 className="h-5 w-5 text-blue-600" />
              <h2 className="font-semibold text-slate-900">Training Plan Generator</h2>
            </div>
            <p className="text-sm text-slate-500 mb-5">
              Describe your training goal and AI will generate a structured, progressive plan with tasks spaced across days.
              You can save it as a reusable template.
            </p>
            <AIPlanGenerator clients={clients} />
          </CardBody>
        </Card>

        {/* Progress Summary */}
        <Card>
          <CardBody className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <BarChart2 className="h-5 w-5 text-blue-600" />
              <h2 className="font-semibold text-slate-900">Progress Summary</h2>
            </div>
            <p className="text-sm text-slate-500 mb-5">
              Generate an AI-written summary of a client&apos;s last 30 days — completion rate, patterns, and suggestions for next steps.
            </p>
            <AIProgressSummary clients={clients} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
