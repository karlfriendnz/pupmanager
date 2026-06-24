'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Check, ChevronsUpDown, Loader2 } from 'lucide-react'

export type Org = { id: string; name: string; role: string }

const ROLE_LABEL: Record<string, string> = { OWNER: 'Owner', MANAGER: 'Manager', STAFF: 'Team member' }

// Lets a trainer who belongs to more than one organisation switch which one
// they're acting in. Posts to /api/trainer/switch-org (re-points the JWT
// server-side), then hard-reloads into the new org's dashboard so every
// server-rendered page picks up the new active business.
export function OrgSwitcher({ orgs, activeId }: { orgs: Org[]; activeId: string | null }) {
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Only multi-org trainers get a switcher.
  if (orgs.length < 2) return null
  const active = orgs.find(o => o.id === activeId) ?? orgs[0]

  async function pick(id: string) {
    if (id === activeId) { setOpen(false); return }
    setSwitching(id)
    try {
      const res = await fetch('/api/trainer/switch-org', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: id }),
      })
      if (res.ok) {
        // Full reload so the refreshed session cookie is read everywhere.
        window.location.assign('/dashboard')
      } else {
        setSwitching(null)
        alert('Could not switch organisation.')
      }
    } catch {
      setSwitching(null)
      alert('Could not switch organisation.')
    }
  }

  return (
    <div ref={ref} className="relative px-3 pt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      >
        <Building2 className="h-4 w-4 text-accent flex-shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-800 truncate">{active.name}</span>
          <span className="block text-[11px] text-slate-400 leading-tight">{ROLE_LABEL[active.role] ?? active.role}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute left-3 right-3 z-40 mt-1 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Your organisations</p>
          {orgs.map(o => {
            const isActive = o.id === activeId
            const isSwitching = switching === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                disabled={switching !== null}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-60 ${isActive ? 'bg-accent-tint' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800 truncate">{o.name}</span>
                  <span className="block text-[11px] text-slate-400 leading-tight">{ROLE_LABEL[o.role] ?? o.role}</span>
                </span>
                {isSwitching ? <Loader2 className="h-4 w-4 animate-spin text-accent flex-shrink-0" />
                  : isActive ? <Check className="h-4 w-4 text-accent flex-shrink-0" /> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
