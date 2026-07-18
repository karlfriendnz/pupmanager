import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { getTrainerEmailReport } from '@/lib/onboarding/email-report'
import { formatDate, formatDateTime } from '@/lib/utils'
import { ArrowLeft, LogIn, Check } from 'lucide-react'
import { TrainerDetailActions } from './trainer-detail-actions'
import { AdminTrainerNotes } from './admin-trainer-notes'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Trainer' }

// ISO 3166-1 alpha-2 → flag emoji, or null for anything that isn't a clean code.
function flagEmoji(iso: string | null): string | null {
  if (!iso || iso.length !== 2 || !/^[A-Za-z]{2}$/.test(iso)) return null
  const cc = iso.toUpperCase()
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

function initials(name: string | null, business: string | null, email: string): string {
  const src = (name?.trim() || business?.trim() || email).trim()
  const parts = src.split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0]!.toUpperCase()
}

export default async function AdminTrainerDetailPage({
  params,
}: {
  params: Promise<{ trainerId: string }>
}) {
  const { trainerId } = await params

  // One company row = an account owner (a User who owns a TrainerProfile).
  const user = await prisma.user.findFirst({
    where: { id: trainerId, role: 'TRAINER', trainerProfile: { isNot: null } },
    include: {
      trainerProfile: {
        select: {
          id: true,
          businessName: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          isInternal: true,
          signupCountry: true,
          gracePeriodUntil: true,
          seatCount: true,
          subscriptionPlan: { select: { name: true } },
          _count: { select: { clients: true, members: true } },
          onboardingProgress: { select: { _count: { select: { emails: true } } } },
        },
      },
    },
  })
  if (!user || !user.trainerProfile) notFound()
  const p = user.trainerProfile

  // Same live-derived signals the table used, now computed once for the detail.
  const [sampleCount, fab, report, notes, tasks] = await Promise.all([
    prisma.clientProfile.count({ where: { trainerId: p.id, isSample: true } }),
    getOnboardingFabState(p.id),
    getTrainerEmailReport(p.id),
    prisma.adminTrainerNote.findMany({ where: { trainerId: p.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.adminTrainerTask.findMany({ where: { trainerId: p.id }, orderBy: [{ done: 'asc' }, { createdAt: 'desc' }] }),
  ])
  const done = fab.steps.filter(s => s.status === 'completed').length
  const total = fab.totalSteps

  const isActive = !user.deactivatedAt
  const graceUntil = p.gracePeriodUntil ? new Date(p.gracePeriodUntil) : null
  const graceActive = !!graceUntil && graceUntil.getTime() > Date.now()
  const trialEnds = p.trialEndsAt ? new Date(p.trialEndsAt) : null
  const flag = flagEmoji(p.signupCountry)

  const statusLabel =
    p.subscriptionStatus === 'TRIALING' ? 'Trial'
      : p.subscriptionStatus === 'ACTIVE' ? (p.subscriptionPlan?.name ?? 'Active')
      : (p.subscriptionStatus ?? 'No plan')
  const statusChip =
    p.subscriptionStatus === 'ACTIVE' ? 'bg-green-900 text-green-300'
      : p.subscriptionStatus === 'TRIALING' ? 'bg-blue-900 text-blue-300'
      : 'bg-slate-700 text-slate-400'

  const stats: { label: string; value: ReactNode }[] = [
    { label: 'Clients', value: p._count.clients },
    { label: 'Seats', value: `${p._count.members} / ${p.seatCount}` },
    {
      label: 'Onboarding',
      value: sampleCount > 0 ? <span className="text-cyan-300 text-lg">Sample data</span> : `${done} / ${total}`,
    },
    { label: 'Emails sent', value: p.onboardingProgress?._count.emails ?? 0 },
    { label: 'Country', value: p.signupCountry ? `${flag ?? ''} ${p.signupCountry}`.trim() : '—' },
    { label: 'Joined', value: formatDate(user.createdAt) },
    { label: 'Last seen', value: user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never' },
    { label: 'Trial ends', value: trialEnds ? formatDate(trialEnds) : '—' },
  ]

  return (
    <div className="max-w-4xl">
      <Link href="/admin/trainers" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-5">
        <ArrowLeft className="h-4 w-4" /> Trainers
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 mb-6">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-700 text-lg font-semibold text-white">
          {initials(user.name, p.businessName, user.email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{p.businessName?.trim() || user.name?.trim() || '—'}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusChip}`}>{statusLabel}</span>
            {graceActive && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-300">Grace</span>}
            {p.isInternal && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900 text-purple-300">Ours</span>}
            {!isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-500/40">Inactive</span>}
          </div>
          <p className="text-slate-300 mt-1">{user.name?.trim() || '—'}</p>
          <p className="text-sm text-slate-500">{user.email}</p>
        </div>
        <a
          href={`/api/admin/impersonate/${user.id}`}
          className="inline-flex items-center gap-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white px-4 h-10 rounded-lg shrink-0"
        >
          <LogIn className="h-4 w-4" /> Log in as
        </a>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{s.label}</p>
            <p className="text-lg font-semibold text-white mt-0.5 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Interactive controls */}
      <TrainerDetailActions
        id={user.id}
        name={user.name}
        email={user.email}
        businessName={p.businessName}
        subscriptionStatus={p.subscriptionStatus}
        trialEndsAt={trialEnds ? trialEnds.toISOString() : null}
        gracePeriodUntil={graceUntil ? graceUntil.toISOString() : null}
        seatCount={p.seatCount}
        isInternal={p.isInternal}
        deactivatedAt={user.deactivatedAt ? user.deactivatedAt.toISOString() : null}
      />

      {/* Onboarding & trial email history */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 mt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Onboarding &amp; trial emails</h2>
        {!report.enrolled && report.enrollmentNote && (
          <p className="text-xs px-3 py-2 mb-3 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-500/30">{report.enrollmentNote}</p>
        )}
        {report.sent.length === 0 && report.upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">No onboarding emails for this trainer.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">When (NZT)</th>
                  <th className="px-3 py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...report.sent.map(e => ({
                    rowKey: `sent-${e.key}`,
                    subject: e.subject,
                    note: null as string | null,
                    status: 'sent' as 'sent' | 'eligible' | 'scheduled' | 'waiting' | 'skip',
                    when: formatDateTime(e.sentAt, 'Pacific/Auckland'),
                  })),
                  ...report.upcoming.map(e => ({
                    rowKey: `up-${e.key}`,
                    subject: e.subject,
                    note: e.note,
                    status: e.status,
                    when:
                      e.status === 'eligible' ? 'Within the hour' :
                      e.status === 'scheduled' ? (e.dueAt ? `~9am ${formatDate(e.dueAt)}` : 'Scheduled') :
                      '—',
                  })),
                ].map(r => {
                  const chip =
                    r.status === 'sent' ? 'bg-emerald-900 text-emerald-300' :
                    r.status === 'eligible' ? 'bg-blue-900 text-blue-300' :
                    r.status === 'scheduled' ? 'bg-slate-700 text-slate-300' :
                    r.status === 'waiting' ? 'bg-purple-900/70 text-purple-300' :
                    'bg-slate-800 text-slate-500'
                  const chipLabel =
                    r.status === 'sent' ? 'Sent' :
                    r.status === 'eligible' ? 'Sending soon' :
                    r.status === 'scheduled' ? 'Scheduled' :
                    r.status === 'waiting' ? 'Waiting' :
                    'Won’t send'
                  return (
                    <tr key={r.rowKey} className={`border-b border-slate-700/40 last:border-0 ${r.status === 'skip' ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2 align-top">
                        <div className="text-slate-200">{r.subject}</div>
                        {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-400 tabular-nums whitespace-nowrap">{r.when}</td>
                      <td className="px-3 py-2 align-top text-right">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${chip}`}>
                          {r.status === 'sent' && <Check className="h-3 w-3" />}
                          {chipLabel}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {report.enrolled && (
          <p className="text-[11px] text-slate-500 mt-3">
            Times in NZT. Time-based emails go out in the ~9am batch in the trainer’s timezone ({report.timezone}); the welcome sends within the hour of signup.
          </p>
        )}
      </div>

      {/* Internal progress diary + to-dos (admin-only, trainer never sees this). */}
      <AdminTrainerNotes
        trainerId={p.id}
        initialNotes={notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() }))}
        initialTasks={tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, createdAt: t.createdAt.toISOString() }))}
      />
    </div>
  )
}
