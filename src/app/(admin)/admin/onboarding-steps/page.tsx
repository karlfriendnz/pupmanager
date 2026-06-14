import { prisma } from '@/lib/prisma'
import { StepsView } from './steps-view'
import { OnboardingSubNav } from '../onboarding-subnav'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Onboarding steps' }

export default async function AdminOnboardingStepsPage() {
  const steps = await prisma.onboardingStep.findMany({ orderBy: { order: 'asc' } })
  const publishedCount = steps.filter(s => s.publishedAt).length

  const items = steps.map(s => ({
    id: s.id,
    key: s.key,
    order: s.order,
    title: s.title,
    body: s.body,
    ctaLabel: s.ctaLabel,
    ctaHref: s.ctaHref,
    skippable: s.skippable,
    skipWarning: s.skipWarning,
    published: !!s.publishedAt,
  }))

  return (
    <div>
      <OnboardingSubNav />
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Onboarding Steps</h1>
        <p className="text-slate-400 text-sm mt-1">
          {steps.length} step{steps.length !== 1 ? 's' : ''} · {publishedCount} published
        </p>
      </div>

      <StepsView steps={items} />
    </div>
  )
}
