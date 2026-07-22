'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'

// Mobile search for the admin top bar. On desktop the Businesses page carries
// its own search field inline; on a phone that field is below the tabs and off
// screen on most views, so this puts it in the header on every admin screen.
//
// Tapping the icon slides the field out across the bar (the same gesture as the
// trainer top bar's client search) and submitting lands on the Businesses list
// filtered by the query — the one search the admin area actually has.
export function AdminTopSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus as it slides open, matching the desktop top bar's behaviour.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const term = q.trim()
    if (!term) return
    setOpen(false)
    router.push(`/admin/trainers?q=${encodeURIComponent(term)}`)
  }

  return (
    <div className="relative flex items-center md:hidden">
      {/* The field slides out over the bar rather than pushing the title around,
          so the header height never jumps. */}
      <form
        onSubmit={submit}
        className={`absolute right-0 top-1/2 -translate-y-1/2 flex items-center transition-all duration-200 ease-out ${
          open ? 'w-[min(70vw,20rem)] opacity-100' : 'pointer-events-none w-9 opacity-0'
        }`}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQ('') } }}
          placeholder="Search businesses…"
          aria-label="Search businesses"
          className="h-9 w-full rounded-full bg-slate-900 border border-slate-600 pl-3 pr-9 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          aria-label="Close search"
          onClick={() => { setOpen(false); setQ('') }}
          className="absolute right-1 grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </form>

      <button
        type="button"
        aria-label="Search"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`grid h-9 w-9 place-items-center rounded-full text-slate-300 hover:bg-slate-700 hover:text-white transition-opacity ${
          open ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <Search className="h-5 w-5" />
      </button>
    </div>
  )
}
