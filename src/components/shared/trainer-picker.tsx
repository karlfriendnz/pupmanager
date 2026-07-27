'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, Check } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'

export interface TrainerOption {
  id: string
  businessName: string
  logoUrl: string | null
  slug: string | null
}

// "Find your trainer" — a search box over business names, results as flat rows
// in one bordered block. Shared by the dog-owner signup form and /find-trainer
// so the two screens behave identically.
//
// It searches instead of listing: a dropdown of every business on the platform
// would be both a directory dump and unusable on a phone.
export function TrainerPicker({
  value,
  onChange,
  autoFocus = false,
}: {
  value: TrainerOption | null
  onChange: (trainer: TrainerOption | null) => void
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<TrainerOption[] | null>(null)
  const [searching, setSearching] = useState(false)
  // Guards against an earlier, slower response overwriting a later one.
  const seq = useRef(0)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    const mine = ++seq.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/trainer-search?q=${encodeURIComponent(term)}`)
        const data = await res.json().catch(() => ({}))
        if (seq.current !== mine) return
        setResults(Array.isArray(data.trainers) ? data.trainers : [])
      } catch {
        if (seq.current === mine) setResults([])
      } finally {
        if (seq.current === mine) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  if (value) {
    return (
      <FlatBlock>
        <div className="flex w-full items-center gap-3 px-4 py-3.5">
          <Check className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-900">{value.businessName}</span>
            <span className="mt-0.5 block text-[13px] text-slate-500">Your trainer</span>
          </span>
          <button
            type="button"
            onClick={() => { onChange(null); setQ('') }}
            className="flex-shrink-0 text-[13px] font-medium text-slate-500 underline underline-offset-2"
          >
            Change
          </button>
        </div>
      </FlatBlock>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by business name"
          aria-label="Search for your trainer by business name"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {searching && (
          <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" aria-hidden />
        )}
      </div>

      {results && results.length > 0 && (
        <FlatBlock>
          {results.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                {t.businessName}
              </span>
            </button>
          ))}
        </FlatBlock>
      )}

      {results && results.length === 0 && !searching && (
        <p className="px-1 text-[13px] leading-snug text-slate-500">
          No business by that name. Trainers can send you a direct link to their
          own page — ask them for it, or skip this and add them later.
        </p>
      )}
    </div>
  )
}
