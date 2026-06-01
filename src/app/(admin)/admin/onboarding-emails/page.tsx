import { prisma } from '@/lib/prisma'
import { AlertTriangle } from 'lucide-react'
import { OnboardingEmailsView } from './onboarding-emails-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Onboarding emails' }

export default async function AdminOnboardingEmailsPage() {
  const [emails, sentCounts] = await Promise.all([
    prisma.onboardingEmail.findMany({ orderBy: { createdAt: 'asc' } }),
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
    sent: sentByKey.get(e.key) ?? 0,
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Onboarding Emails</h1>
        <p className="text-slate-400 text-sm mt-1">
          {emails.length} template{emails.length !== 1 ? 's' : ''} · {publishedCount} published · {totalSent} total sent
        </p>
      </div>

      {totalSent === 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-200">
            The onboarding-email <strong>sender isn’t active yet</strong> (the hourly trigger cron was never built — see
            <span className="font-mono"> docs/onboarding-brief.md</span> “Phase 4”). These are templates only; nothing has been dispatched, which is why every sent count is 0.
          </p>
        </div>
      )}

      <OnboardingEmailsView emails={items} />
    </div>
  )
}
