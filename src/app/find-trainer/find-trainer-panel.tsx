'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Clock3, RefreshCw } from 'lucide-react'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'

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
//   2. They haven't — tell them to get their trainer's sign-up link.
//
// There is no third "empty app" state, which is the whole point.
//
// There is deliberately NO trainer search here. Browsing businesses by name
// meant an unauthenticated stranger could walk the whole customer list, and a
// client signs up through their own trainer's link anyway — so the way in is
// the link, and this screen's job is to say so.
export function FindTrainerPanel({
  pending,
  firstName,
}: {
  pending: PendingRequest[]
  firstName: string | null
}) {
  const [rows] = useState<PendingRequest[]>(pending)
  const [checking, setChecking] = useState(false)

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
              : 'Almost there'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-snug text-slate-600">
          {rows.length > 0
            ? 'Your account is ready. Your trainer just needs to add you to their client list — we’ll email you the moment they do.'
            : 'Your account is ready. The last step is your trainer’s sign-up link — ask them for it and you’ll be connected straight away.'}
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

      <div className="flex flex-col gap-2">
        <SectionLabel>{rows.length > 0 ? 'Train with someone else too?' : 'How to get connected'}</SectionLabel>
        <FlatBlock>
          <div className="flex w-full flex-col gap-1.5 px-4 py-3.5">
            <span className="text-sm font-medium text-slate-900">Ask your trainer for their sign-up link</span>
            <span className="text-[13px] leading-snug text-slate-500">
              It looks like{' '}
              <span className="whitespace-nowrap font-medium text-slate-600">app.pupmanager.com/c/their-business</span>.
              Opening it connects you to them straight away.
            </span>
            <span className="text-[13px] leading-snug text-slate-500">
              They can also invite you directly — ask them to add your email address.
            </span>
          </div>
        </FlatBlock>
      </div>

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
