'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Download, Search } from 'lucide-react'

/**
 * Search, the marketing-only filter, and the CSV export.
 *
 * Export carries the CURRENT filter through, because the export people actually
 * want is "the ones who said yes to marketing" — handing them the whole table
 * and trusting them to filter it in a spreadsheet is how someone ends up mailing
 * a person who declined.
 */
export function LeadsToolbar({ q, optedOnly }: { q: string; optedOnly: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(q)

  function apply(next: { q?: string; opted?: boolean }) {
    const sp = new URLSearchParams(params.toString())
    if (next.q !== undefined) {
      if (next.q) sp.set('q', next.q)
      else sp.delete('q')
    }
    if (next.opted !== undefined) {
      if (next.opted) sp.set('opted', '1')
      else sp.delete('opted')
    }
    router.push(`/admin/leads?${sp.toString()}`)
  }

  const exportHref = `/api/admin/leads/export?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(optedOnly ? { opted: '1' } : {}),
  }).toString()}`

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={e => { e.preventDefault(); apply({ q: value }) }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2"
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Name, business, email or campaign"
          aria-label="Search leads"
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
        />
      </form>

      <button
        type="button"
        onClick={() => apply({ opted: !optedOnly })}
        className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
          optedOnly
            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
            : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
        }`}
      >
        Marketing opt-ins only
      </button>

      <a
        href={exportHref}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
      >
        <Download className="h-4 w-4" strokeWidth={1.75} />
        Export CSV
      </a>
    </div>
  )
}
