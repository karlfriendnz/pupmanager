'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Flame, X } from 'lucide-react'

// Streak popup shown on every dashboard load (by request — no
// once-per-session gate; it remounts each time the trainer lands on
// /dashboard). Tasteful, dismissable, links through to /awards.
export function StreakModal({ current, longest }: { current: number; longest: number }) {
  const [open, setOpen] = useState(true)
  if (!open) return null

  const has = current > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="animate-pm-pop relative z-50 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Purple header */}
        <div className="relative bg-purple-600 px-6 pb-6 pt-7 text-center">
          <button
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 p-1 text-white/70 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-white">
            <Flame className="h-8 w-8" />
          </div>
          <h2 className="mt-3 text-xl font-bold text-white">
            {has ? `You're on a ${current}-day streak!` : 'No streak yet'}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 pt-5 text-center">
          <p className="text-sm text-slate-500">
            {has
              ? `Consecutive training days with your notes done${longest > current ? ` · best: ${longest} days` : ''}. Keep it going by finishing each day's notes.`
              : 'Finish your session notes on a training day to start one. Days with no sessions don’t count against you.'}
          </p>

          <div className="mt-5 flex gap-2">
            <Link
              href="/awards"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View awards
            </Link>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 rounded-xl bg-purple-600 py-2.5 text-sm font-medium text-white hover:bg-purple-700"
            >
              {has ? 'Keep it up' : 'Got it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
