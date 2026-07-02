import { prisma } from '@/lib/prisma'
import { getOnboardingState } from '@/lib/onboarding/state'
import { OnboardingSubNav } from '../onboarding-subnav'
import { Users, Sparkles, Clock, AlertTriangle } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Onboarding funnel' }

const DAY_MS = 1000 * 60 * 60 * 24

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export default async function AdminOnboardingFunnelPage() {
  // Funnel population = every trainer with an onboarding-progress row, minus
  // internal ("Ours") accounts and deactivated users — those skew the metrics
  // exactly like the email sender excludes them.
  const rows = await prisma.trainerOnboardingProgress.findMany({
    select: {
      trainerId: true,
      startedAt: true,
      ahaReachedAt: true,
      firstInviteSentAt: true,
      trainer: {
        select: {
          isInternal: true,
          user: { select: { deactivatedAt: true } },
        },
      },
    },
  })

  const population = rows.filter(r => !r.trainer.isInternal && !r.trainer.user.deactivatedAt)
  const total = population.length

  // ─── Headline metrics ──────────────────────────────────────────────────
  const reachedAha = population.filter(r => r.ahaReachedAt != null)
  const reachedCount = reachedAha.length
  const conversionPct = total > 0 ? (reachedCount / total) * 100 : 0

  const ahaDays = reachedAha.map(r => (r.ahaReachedAt!.getTime() - r.startedAt.getTime()) / DAY_MS)
  const medianAhaDays = median(ahaDays)

  // Limbo: invited a client but no client has signed in yet (no aha).
  const limboCount = population.filter(r => r.firstInviteSentAt != null && r.ahaReachedAt == null).length

  // ─── Per-step funnel ────────────────────────────────────────────────────
  // Tally per step from each trainer's *live-derived* onboarding state. Called
  // sequentially (NOT Promise.all): each getOnboardingState fans out ~11
  // parallel queries, and the Supabase pool is only 15 connections, so a
  // parallel sweep across trainers would exhaust it. Fine at the current small
  // count; at scale this would move to aggregate queries.
  type StepTally = {
    order: number
    title: string
    completed: number
    skipped: number
    notDone: number // pending + in_progress
  }
  const stepTallies = new Map<string, StepTally>()

  for (const r of population) {
    const state = await getOnboardingState(r.trainerId)
    for (const step of state.steps) {
      let t = stepTallies.get(step.key)
      if (!t) {
        t = { order: step.order, title: step.title, completed: 0, skipped: 0, notDone: 0 }
        stepTallies.set(step.key, t)
      }
      // Keep title/order fresh (in case a step row was edited).
      t.order = step.order
      t.title = step.title
      if (step.status === 'completed') t.completed++
      else if (step.status === 'skipped') t.skipped++
      else t.notDone++ // pending or in_progress
    }
  }

  const steps = Array.from(stepTallies.values()).sort((a, b) => a.order - b.order)

  const cards = [
    {
      label: 'Trainers in funnel',
      value: String(total),
      sub: 'real, non-internal, active',
      icon: Users,
      accent: 'text-slate-300',
    },
    {
      label: 'Reached aha',
      value: total > 0 ? `${reachedCount}` : '—',
      sub: total > 0 ? `${conversionPct.toFixed(1)}% conversion` : 'no trainers yet',
      icon: Sparkles,
      accent: 'text-emerald-400',
    },
    {
      label: 'Median time to aha',
      value: medianAhaDays != null ? `${medianAhaDays.toFixed(1)}d` : '—',
      sub: medianAhaDays != null ? `over ${reachedCount} trainer${reachedCount !== 1 ? 's' : ''}` : 'none reached yet',
      icon: Clock,
      accent: 'text-sky-400',
    },
    {
      label: 'In limbo (stuck)',
      value: String(limboCount),
      sub: 'invited, no client sign-in',
      icon: AlertTriangle,
      accent: 'text-amber-400',
    },
  ]

  return (
    <div>
      <OnboardingSubNav />
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Onboarding Funnel</h1>
        <p className="text-slate-400 text-sm mt-1">
          Self-serve onboarding conversion across real trainers.
        </p>
      </div>

      {total === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-6">
          <Users className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-300">
            No real trainers are in the onboarding funnel yet. Internal (“Ours”) and deactivated accounts are excluded,
            so this stays empty until an eligible trainer signs up and starts onboarding.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {cards.map(c => {
              const Icon = c.icon
              return (
                <div key={c.label} className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                  <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wide">
                    <Icon className={`h-4 w-4 ${c.accent}`} />
                    {c.label}
                  </div>
                  <div className="mt-2 text-3xl font-bold">{c.value}</div>
                  <div className="mt-1 text-xs text-slate-400">{c.sub}</div>
                </div>
              )
            })}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700">
              <h2 className="font-semibold">Per-step completion</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Live-derived status for the {total} current real (non-internal, non-deactivated) trainer
                {total !== 1 ? 's' : ''}. This view iterates trainers; at larger scale it would move to aggregate
                queries.
              </p>
            </div>
            <div className="overflow-x-auto">
              {/* min-w keeps the five columns readable — they scroll horizontally
                  on a phone rather than squashing the long headers. */}
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700">
                    <th className="px-4 py-2 font-medium">Step</th>
                    <th className="px-4 py-2 font-medium text-right">Completed</th>
                    <th className="px-4 py-2 font-medium text-right">Skipped</th>
                    <th className="px-4 py-2 font-medium text-right">Not started / in progress</th>
                    <th className="px-4 py-2 font-medium text-right">Completion %</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map(s => {
                    const pct = total > 0 ? (s.completed / total) * 100 : 0
                    return (
                      <tr key={s.title} className="border-b border-slate-700/50 last:border-0">
                        <td className="px-4 py-2.5">{s.title}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-400 tabular-nums">{s.completed}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{s.skipped}</td>
                        <td className="px-4 py-2.5 text-right text-amber-400 tabular-nums">{s.notDone}</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">{pct.toFixed(0)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
