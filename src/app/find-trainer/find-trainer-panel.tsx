'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Clock3, RefreshCw } from 'lucide-react'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { TrainerPicker, type TrainerOption } from '@/components/shared/trainer-picker'

export interface PendingRequest {
  id: string
  createdAt: string
  trainerId: string
  businessName: string
  logoUrl: string | null
}

// The waiting room's contents. Two states, both of which have to make sense to
// someone who was simply told "we use PupManager, go sign up":
//
//   1. They have asked a trainer — say who, say what happens next, and give
//      them a way to check. No spinner-of-hope: their trainer has to act.
//   2. They haven't — search for the business by name and ask.
//
// There is no third "empty app" state, which is the whole point.
export function FindTrainerPanel({
  pending,
  firstName,
}: {
  pending: PendingRequest[]
  firstName: string | null
}) {
  const [rows, setRows] = useState<PendingRequest[]>(pending)
  const [trainer, setTrainer] = useState<TrainerOption | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function request() {
    if (!trainer) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/my/join-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainerId: trainer.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not send your request')
      // Already on their books — the app is ready for them.
      if (data.alreadyClient) {
        window.location.href = '/home'
        return
      }
      setRows(prev =>
        prev.some(r => r.trainerId === trainer.id)
          ? prev
          : [
              {
                id: data.enquiryId ?? trainer.id,
                createdAt: new Date().toISOString(),
                trainerId: trainer.id,
                businessName: trainer.businessName,
                logoUrl: trainer.logoUrl,
              },
              ...prev,
            ],
      )
      setTrainer(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request')
    } finally {
      setSubmitting(false)
    }
  }

  // "Has my trainer added me yet?" — a full reload, because the answer lives in
  // the server layouts: the moment a ClientProfile exists the page above
  // redirects to /home.
  function checkAgain() {
    setChecking(true)
    window.location.reload()
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {rows.length > 0
            ? 'Almost there'
            : firstName
              ? `Welcome, ${firstName}`
              : 'Find your trainer'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-snug text-slate-600">
          {rows.length > 0
            ? 'Your account is ready. Your trainer just needs to add you to their client list — we’ll email you the moment they do.'
            : 'Your account is ready. Search for the business you train with and ask them to add you.'}
        </p>
      </div>

      {rows.length > 0 && (
        <div>
          <SectionLabel>Waiting on</SectionLabel>
          <FlatBlock>
            {rows.map(r => (
              <div key={r.id} className="flex w-full items-center gap-3 px-4 py-3.5">
                <Clock3 className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{r.businessName}</span>
                  <span className="mt-0.5 block text-[13px] text-slate-500">Waiting for them to accept</span>
                </span>
              </div>
            ))}
            <button
              type="button"
              onClick={checkAgain}
              disabled={checking}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-[18px] w-[18px] flex-shrink-0 text-slate-700 ${checking ? 'animate-spin' : ''}`}
                strokeWidth={1.75}
              />
              <span className="text-sm font-medium text-slate-900">Check again</span>
            </button>
          </FlatBlock>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <SectionLabel>{rows.length > 0 ? 'Train with someone else too?' : 'Your trainer'}</SectionLabel>
        <TrainerPicker value={trainer} onChange={setTrainer} />
        {trainer && (
          <button
            type="button"
            onClick={request}
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
            style={{ background: 'var(--pm-brand-600)' }}
          >
            {submitting ? 'Sending…' : `Ask ${trainer.businessName} to add me`}
          </button>
        )}
        {error && <p className="text-center text-xs text-red-600">{error}</p>}
      </div>

      <p className="text-center text-[13px] leading-snug text-slate-500">
        Can&apos;t find them? Ask your trainer for their PupManager link — it looks
        like <span className="whitespace-nowrap font-medium text-slate-600">app.pupmanager.com/c/their-business</span>.
      </p>

      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="text-center text-sm font-medium text-slate-500 underline underline-offset-2"
      >
        Sign out
      </button>
    </div>
  )
}
