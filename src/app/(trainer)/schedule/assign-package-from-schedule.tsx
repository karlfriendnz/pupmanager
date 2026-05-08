'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Package as PackageIcon, X, AlertTriangle, ChevronDown, Check, Search } from 'lucide-react'
import { findNextAvailable, type AvailabilityRow } from '@/lib/availability'

interface ClientOption {
  id: string
  name: string
  dogs?: { id: string; name: string }[]
}

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
// Initial buffer materialised when the trainer picks "No end date".
// Subsequent loads keep topping up via lib/extend-ongoing-packages.
const EXTEND_BUFFER_WEEKS = 6

export function AssignPackageFromScheduleButton({
  clients,
  packages,
  availability,
  defaultStartDate,
  defaultStartTime,
}: {
  clients: ClientOption[]
  packages: PkgOption[]
  availability: AvailabilityRow[]
  defaultStartDate?: string  // YYYY-MM-DD
  defaultStartTime?: string  // HH:mm — when set, pins session 1 to that exact time
}) {
  const [open, setOpen] = useState(false)

  const disabled = clients.length === 0 || packages.length === 0
  const title = clients.length === 0
    ? 'No clients yet'
    : packages.length === 0
    ? 'Create a package first at /packages'
    : undefined

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={title}
      >
        <PackageIcon className="h-4 w-4" />
        Assign package
      </Button>
      {open && (
        <AssignPackageFromScheduleModal
          clients={clients}
          packages={packages}
          availability={availability}
          defaultStartDate={defaultStartDate}
          defaultStartTime={defaultStartTime}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export function AssignPackageFromScheduleModal({
  clients,
  packages,
  availability,
  defaultStartDate,
  defaultStartTime,
  onClose,
}: {
  clients: ClientOption[]
  packages: PkgOption[]
  availability: AvailabilityRow[]
  defaultStartDate?: string
  defaultStartTime?: string
  onClose: () => void
}) {
  // Guard against opening the modal before any clients/packages exist —
  // both `useState(arr[0].id)` calls below would crash on an empty array.
  // Surfaces an empty state instead so the trainer knows what to do.
  if (clients.length === 0 || packages.length === 0) {
    return <EmptyAssignModal hasClients={clients.length > 0} hasPackages={packages.length > 0} onClose={onClose} />
  }
  return (
    <AssignPackageFromScheduleModalInner
      clients={clients}
      packages={packages}
      availability={availability}
      defaultStartDate={defaultStartDate}
      defaultStartTime={defaultStartTime}
      onClose={onClose}
    />
  )
}

function EmptyAssignModal({
  hasClients,
  hasPackages,
  onClose,
}: {
  hasClients: boolean
  hasPackages: boolean
  onClose: () => void
}) {
  const missing: string[] = []
  if (!hasClients) missing.push('a client')
  if (!hasPackages) missing.push('a package')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
        <PackageIcon className="h-8 w-8 mx-auto text-slate-300 mb-3" />
        <h2 className="font-semibold text-slate-900">Add {missing.join(' and ')} first</h2>
        <p className="text-sm text-slate-500 mt-1.5">
          You need {missing.join(' and ')} before you can assign a package.
        </p>
        <Button variant="ghost" onClick={onClose} className="mt-4">Close</Button>
      </div>
    </div>
  )
}

function AssignPackageFromScheduleModalInner({
  clients,
  packages,
  availability,
  defaultStartDate,
  defaultStartTime,
  onClose,
}: {
  clients: ClientOption[]
  packages: PkgOption[]
  availability: AvailabilityRow[]
  defaultStartDate?: string
  defaultStartTime?: string
  onClose: () => void
}) {
  const router = useRouter()
  const [clientId, setClientId] = useState(clients[0].id)
  const [packageId, setPackageId] = useState(packages[0].id)
  // Dog defaults to the client's only dog when there's exactly one (the common
  // case); null when the client has no dogs or multiple and no choice is made.
  const clientDogs = clients.find(c => c.id === clientId)?.dogs ?? []
  const [dogId, setDogId] = useState<string | null>(clientDogs.length === 1 ? clientDogs[0].id : null)
  // Reset the dog whenever the chosen client changes.
  useEffect(() => {
    const dogs = clients.find(c => c.id === clientId)?.dogs ?? []
    setDogId(dogs.length === 1 ? dogs[0].id : null)
  }, [clientId, clients])
  const [startDate, setStartDate] = useState(() => defaultStartDate ?? defaultTomorrow())
  // Empty string = "auto-find via availability"; HH:MM = "pin session 1 here"
  const [startTime, setStartTime] = useState(() => defaultStartTime ?? '')
  // Only used when the chosen package has sessionCount = 0 (ongoing). Defaults
  // to ONGOING_DEFAULT_WEEKS after the start date and recomputes whenever the
  // start date changes — see effect below.
  const [endDate, setEndDate] = useState(() => addWeeksISO(defaultStartDate ?? defaultTomorrow(), ONGOING_DEFAULT_WEEKS))
  // "No end date" — the assignment auto-extends ~6 weeks at a time on each
  // schedule load. Only applies to ongoing packages.
  const [noEnd, setNoEnd] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Trainer-side "I've already invoiced this" flag. Stamps invoicedAt on
  // the new ClientPackage row.
  const [markInvoiced, setMarkInvoiced] = useState(false)

  const pkg = packages.find(p => p.id === packageId)!
  const isOngoing = pkg.sessionCount === 0

  // Keep the end date a sensible distance ahead of the start date when the
  // start moves past it. Leaves the user's chosen end date alone otherwise.
  useEffect(() => {
    setEndDate(prev => (prev < startDate ? addWeeksISO(startDate, ONGOING_DEFAULT_WEEKS) : prev))
  }, [startDate])

  // Compute proposed session datetimes.
  // - If the trainer pins a "First time", every subsequent session inherits
  //   that same time on its cadence-derived day. This keeps the package
  //   visually aligned (e.g. "every other Tuesday at 10am") and matches the
  //   trainer's intuition — change the time once, every connected session
  //   shifts with it.
  // - With no pinned time, sessions 2..N are auto-placed by availability
  //   search forward by weeksBetween from the previous session.
  // Ongoing packages keep walking forward until either the end date or the
  // safety cap is hit.
  const proposals = useMemo<({ at: Date | null })[]>(() => {
    const out: ({ at: Date | null })[] = []
    const start = parseDate(startDate)
    if (!start) return isOngoing ? [] : Array.from({ length: pkg.sessionCount }, () => ({ at: null }))

    // "No end date" mode generates an initial 6-week buffer, then schedule
    // page loads keep topping it up via extendOngoingPackages.
    const effectiveEndStr = noEnd ? addWeeksISO(startDate, EXTEND_BUFFER_WEEKS) : endDate
    const end = isOngoing ? parseDate(effectiveEndStr) : null
    // For ongoing packages, weeksBetween 0 would loop forever — clamp to 1.
    const cadenceWeeks = isOngoing ? Math.max(1, pkg.weeksBetween) : pkg.weeksBetween
    const limit = isOngoing ? ONGOING_MAX_SESSIONS : pkg.sessionCount
    const pinnedTime = startTime
      ? (() => { const [h, m] = startTime.split(':').map(Number); return { h, m } })()
      : null

    let cursor: Date = start

    for (let i = 0; i < limit; i++) {
      if (end && cursor > end) break

      let placed: Date | null
      if (pinnedTime) {
        // Honour the trainer's chosen time on every session, not just the
        // first one.
        placed = new Date(cursor)
        placed.setHours(pinnedTime.h, pinnedTime.m, 0, 0)
      } else {
        placed = findNextAvailable(availability, cursor, pkg.durationMins, SLOT_SEARCH_DAYS)
      }
      // Stop once we've walked past the end date — don't add a placeholder past it.
      if (end && placed && placed > end) break
      if (isOngoing && !placed) break
      out.push({ at: placed })

      const base = placed ?? cursor
      const next = new Date(base)
      next.setDate(next.getDate() + cadenceWeeks * 7)
      cursor = next
    }
    return out
  }, [availability, pkg, startDate, startTime, endDate, isOngoing, noEnd])

  const placedCount = proposals.filter(p => p.at !== null).length
  const allPlaced = isOngoing ? placedCount > 0 : placedCount === pkg.sessionCount
  const anyMissing = !isOngoing && placedCount < pkg.sessionCount

  // Conflict detection: pull existing sessions in the proposal range and
  // flag any proposal whose interval overlaps. Refetches when the date
  // range covered by proposals changes.
  const [existing, setExisting] = useState<{ id: string; title: string; scheduledAt: string; durationMins: number }[]>([])
  const placed = proposals.map(p => p.at).filter((d): d is Date => d !== null)
  const rangeFromIso = placed.length > 0 ? new Date(placed[0].getTime() - 60 * 60 * 1000).toISOString() : null
  const rangeToIso = placed.length > 0
    ? new Date(placed[placed.length - 1].getTime() + pkg.durationMins * 60 * 1000 + 60 * 60 * 1000).toISOString()
    : null
  useEffect(() => {
    if (!rangeFromIso || !rangeToIso) { setExisting([]); return }
    let cancelled = false
    fetch(`/api/schedule/range?from=${encodeURIComponent(rangeFromIso)}&to=${encodeURIComponent(rangeToIso)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (!cancelled) setExisting(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [rangeFromIso, rangeToIso])

  function conflictFor(at: Date): { id: string; title: string; scheduledAt: string } | null {
    const startA = at.getTime()
    const endA = startA + pkg.durationMins * 60 * 1000
    for (const s of existing) {
      const startB = new Date(s.scheduledAt).getTime()
      const endB = startB + s.durationMins * 60 * 1000
      if (startA < endB && startB < endA) return { id: s.id, title: s.title, scheduledAt: s.scheduledAt }
    }
    return null
  }
  const conflictsCount = proposals.filter(p => p.at && conflictFor(p.at)).length

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
      body: JSON.stringify({
        packageId,
        sessionDates,
        dogId,
        extendIndefinitely: isOngoing && noEnd,
        markInvoiced,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body?.error?.toString() ?? 'Failed to assign package')
      setSubmitting(false)
      return
    }
    onClose()
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
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Client</label>
            <ClientPicker clients={clients} value={clientId} onChange={setClientId} />
          </div>

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

          {clientDogs.length > 0 && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">
                Dog {clientDogs.length === 1 && <span className="text-slate-400 font-normal">(only dog auto-selected)</span>}
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
                {clientDogs.map(d => (
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

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Start day</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="w-36">
              <label className="text-sm font-medium text-slate-700 block mb-1.5">
                First time <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 -mt-2">
            {startTime
              ? `Every session pinned to ${startTime}. Clear the time to auto-place each in your next available slot.`
              : 'Each session is auto-placed in your next available slot from this day onward.'}
          </p>

          {isOngoing && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-700">End date</label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noEnd}
                    onChange={e => setNoEnd(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  No end date
                </label>
              </div>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                disabled={noEnd}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                {noEnd
                  ? `Forever ongoing — first ${EXTEND_BUFFER_WEEKS} weeks created now; the schedule keeps ${EXTEND_BUFFER_WEEKS} weeks of upcoming sessions topped up automatically.`
                  : `Ongoing package — sessions repeat every ${Math.max(1, pkg.weeksBetween)} week${Math.max(1, pkg.weeksBetween) > 1 ? 's' : ''} until this date.`}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Proposed sessions
            </p>
            <div className="flex flex-col gap-1.5">
              {proposals.map((p, i) => {
                const conflict = p.at ? conflictFor(p.at) : null
                return (
                  <div
                    key={i}
                    className={`flex flex-col gap-1 text-sm rounded-lg px-3 py-2 ${
                      !p.at
                        ? 'bg-amber-50 border border-amber-200'
                        : conflict
                          ? 'bg-amber-50 border border-amber-200'
                          : 'bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 flex items-center gap-1.5">
                        {(!p.at || conflict) && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
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
                    {conflict && (
                      <p className="text-[11px] text-amber-700 ml-5">
                        Already booked: {conflict.title}
                        {' at '}
                        {new Date(conflict.scheduledAt).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            {conflictsCount > 0 && (
              <p className="text-[11px] text-amber-700 mt-2">
                {conflictsCount} session{conflictsCount > 1 ? 's' : ''} overlap an existing booking. Pick a different time or proceed and resolve manually.
              </p>
            )}
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
                Tick if you&apos;ve sent the invoice for this package outside PupManager.
              </span>
            </span>
          </label>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleSubmit}
              loading={submitting}
              disabled={placedCount === 0}
              variant={allPlaced ? 'primary' : 'primary'}
            >
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
  // Build at noon to avoid timezone-shift bugs spilling into the previous day
  return new Date(y, m - 1, d, 12, 0, 0)
}

// Custom client picker — replaces the native <select> so each option can show
// the client's dogs as inline pills. Includes a search box that filters by
// client name or dog name. No keyboard nav (Tab/Enter only); plenty for a
// trainer's roster of 50–100 clients.
function ClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: ClientOption[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = clients.find(c => c.id === value)

  // Close on outside click. Mousedown rather than click so we beat the next
  // focus shift.
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Reset the query whenever the panel closes so the next open starts fresh.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(c => {
      if (c.name.toLowerCase().includes(q)) return true
      return (c.dogs ?? []).some(d => d.name.toLowerCase().includes(q))
    })
  }, [clients, query])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-2"
      >
        <div className="flex-1 min-w-0">
          {selected ? (
            (() => {
              const dogs = selected.dogs ?? []
              if (dogs.length === 0) {
                return <span className="font-medium text-slate-900 truncate block">{selected.name}</span>
              }
              return (
                <div>
                  <p className="font-semibold text-slate-900 truncate leading-tight">
                    🐕 {dogs.map(d => d.name).join(', ')}
                  </p>
                  <p className="text-xs text-slate-500 truncate leading-tight mt-0.5">{selected.name}</p>
                </div>
              )
            })()
          ) : (
            <span className="text-slate-400">Select client…</span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-72">
          <div className="p-2 border-b border-slate-100 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Search clients or dogs…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 px-3 py-3">No matches.</p>
            ) : filtered.map(c => {
              const isSelected = c.id === value
              const dogs = c.dogs ?? []
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onChange(c.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-start gap-2 ${
                    isSelected ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {dogs.length > 0 ? (
                      <>
                        <p className={`text-sm truncate leading-tight ${isSelected ? 'font-semibold text-blue-900' : 'font-semibold text-slate-900'}`}>
                          🐕 {dogs.map(d => d.name).join(', ')}
                        </p>
                        <p className="text-xs text-slate-500 truncate leading-tight mt-0.5">{c.name}</p>
                      </>
                    ) : (
                      <p className={`text-sm truncate ${isSelected ? 'font-semibold text-blue-900' : 'font-medium text-slate-800'}`}>
                        {c.name}
                      </p>
                    )}
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
