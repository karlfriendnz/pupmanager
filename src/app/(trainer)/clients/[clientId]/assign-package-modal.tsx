'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Package as PackageIcon, X, AlertTriangle } from 'lucide-react'
import { findNextAvailable, type AvailabilityRow } from '@/lib/availability'

interface PkgOption {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
}

const SLOT_SEARCH_DAYS = 60
// Hard ceiling on sessions created in one assignment — matches the API's
// `sessionDates` schema (max 52). Protects against runaway loops if an ongoing
// package somehow ends up with a 0-week cadence.
const ONGOING_MAX_SESSIONS = 52
// Default end date offered for ongoing packages (12 weeks from start).
const ONGOING_DEFAULT_WEEKS = 12

// External `open` + `onOpenChange` make this controllable from the
// new ClientActionsMenu. When omitted (legacy callers), the
// component renders its own trigger Button and manages state itself.
export function AssignPackageButton({
  clientId,
  packages,
  availability,
  dogs,
  open: externalOpen,
  onOpenChange,
}: {
  clientId: string
  packages: PkgOption[]
  availability: AvailabilityRow[]
  dogs?: { id: string; name: string }[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = externalOpen !== undefined
  const open = isControlled ? externalOpen : internalOpen
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v)
    else setInternalOpen(v)
  }

  if (packages.length === 0) {
    if (isControlled) {
      // In a menu — silently no-op when triggered. The menu can
      // gate the item itself based on `packages.length`.
      return null
    }
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => alert('Create a package first at /packages')}
        title="No packages defined yet"
      >
        <PackageIcon className="h-4 w-4" />
        Assign package
      </Button>
    )
  }

  return (
    <>
      {!isControlled && (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <PackageIcon className="h-4 w-4" />
          Assign package
        </Button>
      )}
      {open && (
        <AssignModal
          clientId={clientId}
          packages={packages}
          availability={availability}
          dogs={dogs ?? []}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function AssignModal({
  clientId,
  packages,
  availability,
  dogs,
  onClose,
}: {
  clientId: string
  packages: PkgOption[]
  availability: AvailabilityRow[]
  dogs: { id: string; name: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const [packageId, setPackageId] = useState(packages[0].id)
  const [startDate, setStartDate] = useState(defaultTomorrow())
  // Only used when the chosen package has sessionCount = 0 (ongoing).
  const [endDate, setEndDate] = useState(() => addWeeksISO(defaultTomorrow(), ONGOING_DEFAULT_WEEKS))
  // Default to the only dog when there's exactly one (the common case).
  const [dogId, setDogId] = useState<string | null>(dogs.length === 1 ? dogs[0].id : null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Trainer ticks this when they've already sent the invoice for the package
  // outside PupManager (Xero/QBO/cash). Stamps invoicedAt on the assignment.
  const [markInvoiced, setMarkInvoiced] = useState(false)

  const pkg = packages.find(p => p.id === packageId)!
  const isOngoing = pkg.sessionCount === 0

  // Snap end date forward if the user moves the start past it.
  useEffect(() => {
    setEndDate(prev => (prev < startDate ? addWeeksISO(startDate, ONGOING_DEFAULT_WEEKS) : prev))
  }, [startDate])

  const proposals = useMemo<({ at: Date | null })[]>(() => {
    const out: ({ at: Date | null })[] = []
    const start = parseDate(startDate)
    if (!start) return isOngoing ? [] : Array.from({ length: pkg.sessionCount }, () => ({ at: null }))

    const end = isOngoing ? parseDate(endDate) : null
    const cadenceWeeks = isOngoing ? Math.max(1, pkg.weeksBetween) : pkg.weeksBetween
    const limit = isOngoing ? ONGOING_MAX_SESSIONS : pkg.sessionCount

    let cursor = start
    for (let i = 0; i < limit; i++) {
      if (end && cursor > end) break
      const found = findNextAvailable(availability, cursor, pkg.durationMins, SLOT_SEARCH_DAYS)
      if (end && found && found > end) break
      if (isOngoing && !found) break
      out.push({ at: found })
      const base = found ?? cursor
      const next = new Date(base)
      next.setDate(next.getDate() + cadenceWeeks * 7)
      cursor = next
    }
    return out
  }, [availability, pkg, startDate, endDate, isOngoing])

  const placedCount = proposals.filter(p => p.at !== null).length
  const allPlaced = isOngoing ? placedCount > 0 : placedCount === pkg.sessionCount
  const anyMissing = !isOngoing && placedCount < pkg.sessionCount

  async function handleSubmit() {
    if (placedCount === 0) {
      setError('No availability found for any session. Add availability slots first.')
      return
    }
    setSubmitting(true)
    setError(null)
    const sessionDates = proposals
      .map(p => p.at)
      .filter((d): d is Date => d !== null)
      .map(d => d.toISOString())

    const res = await fetch(`/api/clients/${clientId}/packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, sessionDates, dogId, markInvoiced }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body?.error?.toString() ?? 'Failed to assign package')
      setSubmitting(false)
      return
    }
    onClose()
    router.replace(`/clients/${clientId}?tab=sessions`)
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Assign package</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Package</label>
            <select
              value={packageId}
              onChange={e => setPackageId(e.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {packages.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sessionCount === 0 ? 'ongoing' : `${p.sessionCount} sessions`}, every {p.weeksBetween} wk)
                </option>
              ))}
            </select>
            {pkg.description && (
              <p className="text-xs text-slate-500 mt-1.5">{pkg.description}</p>
            )}
          </div>

          {dogs.length > 0 && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">
                Dog {dogs.length === 1 && <span className="text-slate-400 font-normal">(only dog auto-selected)</span>}
              </label>
              <div className="flex gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setDogId(null)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                    dogId === null
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  No dog
                </button>
                {dogs.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDogId(d.id)}
                    className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                      dogId === d.id
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    🐕 {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Start day</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Each session is auto-placed in your next available slot from this day onward.
            </p>
          </div>

          {isOngoing && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">End date</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Ongoing package — sessions repeat every {Math.max(1, pkg.weeksBetween)} week{Math.max(1, pkg.weeksBetween) > 1 ? 's' : ''} until this date.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Proposed sessions
            </p>
            <div className="flex flex-col gap-1.5">
              {proposals.map((p, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${
                    p.at ? 'bg-slate-50' : 'bg-amber-50 border border-amber-200'
                  }`}
                >
                  <span className="text-slate-600 flex items-center gap-1.5">
                    {!p.at && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    Session {i + 1}{isOngoing ? '' : `/${pkg.sessionCount}`}
                  </span>
                  {p.at ? (
                    <span className="text-slate-900 font-medium">
                      {p.at.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' · '}
                      {p.at.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  ) : (
                    <span className="text-amber-700 font-medium text-xs">
                      No availability in {SLOT_SEARCH_DAYS} days
                    </span>
                  )}
                </div>
              ))}
            </div>
            {anyMissing && (
              <p className="text-[11px] text-amber-700 mt-2">
                {pkg.sessionCount - placedCount} of {pkg.sessionCount} sessions could not be placed.
                {' '}They will be skipped — add availability slots in the schedule first to include them.
              </p>
            )}
            {isOngoing && proposals.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-2">
                No availability between the start and end dates — add availability slots first.
              </p>
            )}
            {isOngoing && proposals.length === ONGOING_MAX_SESSIONS && (
              <p className="text-[11px] text-slate-400 mt-2">
                Capped at {ONGOING_MAX_SESSIONS} sessions per assignment — assign again to extend further.
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Each session is {pkg.durationMins} min, {pkg.sessionType === 'VIRTUAL' ? 'virtual' : 'in person'}.
              You can drag any of them on the calendar afterwards.
            </p>
          </div>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={markInvoiced}
              onChange={e => setMarkInvoiced(e.target.checked)}
              className="h-4 w-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer flex-shrink-0"
            />
            <span className="text-sm text-slate-700 leading-snug">
              Already invoiced
              <span className="block text-[11px] text-slate-400 mt-0.5">
                Tick if you&apos;ve sent the invoice for this package outside PupManager (Xero, QuickBooks, etc).
              </span>
            </span>
          </label>

          <div className="flex gap-2 pt-1">
            <Button onClick={handleSubmit} loading={submitting} disabled={placedCount === 0}>
              {allPlaced
                ? 'Assign & create sessions'
                : `Create ${placedCount} session${placedCount === 1 ? '' : 's'}`}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function defaultTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addWeeksISO(dateStr: string, weeks: number): string {
  const d = parseDate(dateStr) ?? new Date()
  d.setDate(d.getDate() + weeks * 7)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseDate(s: string): Date | null {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0)
}
