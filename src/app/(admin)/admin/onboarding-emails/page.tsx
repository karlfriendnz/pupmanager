import { prisma } from '@/lib/prisma'
import { AlertTriangle } from 'lucide-react'
import { OnboardingEmailsView } from './onboarding-emails-view'
import { OnboardingSubNav } from '../onboarding-subnav'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Onboarding emails' }

export default async function AdminOnboardingEmailsPage() {
  const [emails, sentCounts] = await Promise.all([
    prisma.onboardingEmail.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.trainerOnboardingEmailLog.groupBy({ by: ['emailKey'], _count: { _all: true } }),
  ])
  const sentByKey = new Map(sentCounts.map(c => [c.emailKey, c._count._all]))
  const totalSent = sentCounts.reduce((n, c) => n + c._count._all, 0)
  const publishedCount = emails.filter(e => e.publishedAt).length

  const items = emails.map(e => ({
    id: e.id,
    key: e.key,
    subject: e.subject,
    senderKey: e.senderKey,
    published: !!e.publishedAt,
    triggerRule: e.triggerRule,
    body: e.body,
    topText: e.topText,
    imageUrl: e.imageUrl,
    imageHeight: e.imageHeight,
    linkUrl: e.linkUrl,
    imageUrl2: e.imageUrl2,
    imageHeight2: e.imageHeight2,
    linkUrl2: e.linkUrl2,
    bottomText: e.bottomText,
    sent: sentByKey.get(e.key) ?? 0,
  }))

  return (
    <div>
      <OnboardingSubNav />
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Onboarding Emails</h1>
        <p className="text-slate-400 text-sm mt-1">
          {emails.length} template{emails.length !== 1 ? 's' : ''} · {publishedCount} published · {totalSent} total sent
        </p>
      </div>

      {totalSent === 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-sky-400 shrink-0 mt-0.5" />
          <p className="text-sm text-sky-200">
            The hourly sender <strong>is live</strong>. It only dispatches <strong>published</strong> templates to real
            trainers who signed up <strong>on/after the 2026-06-07 launch</strong> — internal (“Ours”), deactivated, and
            pre-launch accounts are skipped by design. A count of 0 is expected until an eligible trainer hits a trigger.
          </p>
        </div>
      )}

      <OnboardingEmailsView emails={items} />
    </div>
  )
}
