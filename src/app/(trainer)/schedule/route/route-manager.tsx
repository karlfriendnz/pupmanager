'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Home, Navigation, Loader2, Pencil, ChevronLeft, ChevronRight, Check, Video, MapPinOff, ArrowRight } from 'lucide-react'
import { loadMaps } from '@/components/maps/maps-loader'
import { PlaceAutocomplete, type PlaceResult } from '@/components/maps/place-autocomplete'

// A day's stop, as /api/route/day returns it. Mirrors DayStop in lib/route-day.
type Stop = {
  id: string
  kind: 'client' | 'group'
  clientId: string | null
  classRunId: string | null
  name: string
  kindLabel: string
  href: string
  address: string | null
  lat: number | null
  lng: number | null
  time?: string | null
  endTime?: string | null
  timeMins?: number | null
  dogs?: string[]
  attendees?: number
  visitMins?: number
  blocked: 'virtual' | 'no-location' | 'no-address' | null
}
type Base = { address: string | null; lat: number; lng: number } | null
type Member = { id: string; name: string }
type OptStop = {
  stopId: string
  kind: 'client' | 'group'
  clientId: string | null
  classRunId: string | null
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  legDurationSec: number | null
  legDistanceMeters: number | null
}
type OptResult = { stops: OptStop[]; totalDurationSec: number; totalDistanceMeters: number; polyline: string | null }

const AUCKLAND = { lat: -36.8485, lng: 174.7633 }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
// Marker bubble: the stop's name + a link to whatever it is (new tab).
const bubble = (name: string, href: string, openLabel: string, time?: string | null) =>
  `<div style="font:14px -apple-system,sans-serif;min-width:120px">
     <strong>${esc(name)}</strong>${time ? ` · ${esc(time)}` : ''}<br/>
     <a href="${esc(href)}" target="_blank" rel="noopener" style="color:#2563eb">${esc(openLabel)} →</a>
   </div>`

export function RouteManager({
  base: initialBase,
  stops: initialStops,
  members,
  initialDate,
  region,
}: {
  base: Base
  stops: Stop[]
  members: Member[]
  initialDate: string
  // ISO alpha-2 of the trainer's country — localises address suggestions.
  region?: string
}) {
  const searchParams = useSearchParams()
  const urlDate = searchParams.get('date')
  const validUrlDate = urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : null

  const [base, setBase] = useState<Base>(initialBase)
  const [stops, setStops] = useState<Stop[]>(initialStops)
  // Date is driven by the URL (?date) so clicking a day in the schedule always
  // reflects here, regardless of server re-render/caching.
  const [date, setDate] = useState(validUrlDate ?? initialDate)
  const [memberId, setMemberId] = useState('all')
  // 'time' = keep booked-time order (default — you can't do the 4pm before the
  // 1pm); 'shortest' = let Google reorder for least driving (flexible days).
  const [orderMode, setOrderMode] = useState<'time' | 'shortest'>('time')
  const [loadingDay, setLoadingDay] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialStops.filter(s => s.blocked == null).map(s => s.id)),
  )
  const [result, setResult] = useState<OptResult | null>(null)
  const [optimising, setOptimising] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingAddrFor, setSettingAddrFor] = useState<string | null>(null)
  const [showBaseInput, setShowBaseInput] = useState(false)

  const gRef = useRef<typeof google | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([])
  const mapHost = useRef<HTMLDivElement>(null)
  const [mapReady, setMapReady] = useState(false)

  const hasBase = base != null

  // Init map once — but only once there IS a base. Without one the planner
  // renders its explanation instead of the map/column, so mapHost isn't
  // mounted and loadMaps() would burn a script load on a hidden pane.
  useEffect(() => {
    if (!hasBase) return
    let cancelled = false
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY) {
      setError('Browser maps key missing in the page — NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY not inlined (dev server needs a restart after adding it).')
      return
    }
    // Google calls this on an auth failure (bad key / API not enabled / billing).
    ;(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      if (!cancelled) setError('Maps auth failed — Maps JavaScript API not enabled for this key, or billing/referrer issue (browser key).')
    }
    loadMaps()
      .then(google => {
        if (cancelled || !mapHost.current) return
        gRef.current = google
        mapRef.current = new google.maps.Map(mapHost.current, {
          center: base ? { lat: base.lat, lng: base.lng } : AUCKLAND,
          zoom: 12, disableDefaultUI: true, zoomControl: true,
          // Hide business / POI / transit labels — just streets + our markers.
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
          ],
        })
        setMapReady(true)
      })
      .catch((e: unknown) => setError(`Map error: ${e instanceof Error ? e.message : String(e)}`))
    return () => { cancelled = true }
  }, [hasBase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw markers + route whenever inputs change.
  useEffect(() => {
    const google = gRef.current, map = mapRef.current
    if (!google || !map) return
    overlaysRef.current.forEach(o => o.setMap?.(null))
    overlaysRef.current = []
    const bounds = new google.maps.LatLngBounds()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const add = (o: any) => overlaysRef.current.push(o)
    const info = (infoRef.current ??= new google.maps.InfoWindow())
    // Marker that opens a bubble on click.
    const stopMarker = (
      opts: google.maps.MarkerOptions,
      content: { name: string; href: string; openLabel: string; time?: string | null },
    ) => {
      const m = new google.maps.Marker(opts)
      m.addListener('click', () => {
        info.setContent(bubble(content.name, content.href, content.openLabel, content.time))
        info.open(map, m)
      })
      add(m)
      return m
    }

    if (base) {
      add(new google.maps.Marker({ position: base, map, label: { text: '🏠', fontSize: '16px' }, title: 'Base' }))
      bounds.extend(base)
    }

    if (result) {
      // A venue sent as free text has no coordinates until Google resolves it,
      // which it does as part of the optimise call — so every optimised stop
      // can be pinned, class venues included.
      result.stops.forEach((s, i) => {
        if (s.lat == null || s.lng == null) return
        const src = stops.find(x => x.id === s.stopId)
        stopMarker(
          { position: { lat: s.lat, lng: s.lng }, map, label: { text: String(i + 1), color: '#fff', fontWeight: '700' }, title: `${i + 1}. ${s.name}` },
          { name: s.name, href: src?.href ?? '#', openLabel: openLabelFor(src), time: src?.time },
        )
        bounds.extend({ lat: s.lat, lng: s.lng })
      })
      if (result.polyline) {
        const path = google.maps.geometry.encoding.decodePath(result.polyline)
        add(new google.maps.Polyline({ path, map, strokeColor: '#2a9da9', strokeWeight: 4, strokeOpacity: 0.85 }))
      }
    } else {
      stops.filter(s => s.lat != null && selected.has(s.id)).forEach(s => {
        stopMarker({ position: { lat: s.lat!, lng: s.lng! }, map, title: s.name }, { name: s.name, href: s.href, openLabel: openLabelFor(s), time: s.time })
        bounds.extend({ lat: s.lat!, lng: s.lng! })
      })
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 80)
      // Don't let a tight cluster (or a lone base marker) zoom in to street
      // level — cap the auto-fit so it stays zoomed out a bit.
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? 0) > 13) map.setZoom(13)
      })
    }
  }, [base, stops, selected, result, mapReady])

  async function saveBase(r: PlaceResult) {
    setBase({ address: r.address, lat: r.lat, lng: r.lng })
    setShowBaseInput(false); setResult(null); setError(null)
    await fetch('/api/route/base', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
  }
  async function saveClientAddr(stopId: string, clientId: string, r: PlaceResult) {
    setStops(ss => ss.map(s => (s.id === stopId ? { ...s, address: r.address, lat: r.lat, lng: r.lng, blocked: null } : s)))
    setSelected(s => new Set(s).add(stopId))
    setSettingAddrFor(null); setResult(null)
    await fetch(`/api/clients/${clientId}/location`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
  }
  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
    setResult(null)
  }

  // Keep `date` in sync with the URL (?date) — e.g. clicking a day in the schedule.
  useEffect(() => {
    if (validUrlDate && validUrlDate !== date) setDate(validUrlDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validUrlDate])

  // Always fetch the day's stops for the current date/member (incl. on mount,
  // so landing on a specific day shows that day, not the server's default).
  // Skipped without a base — there is no route to plan yet.
  useEffect(() => {
    if (!hasBase) return
    let cancelled = false
    setLoadingDay(true); setResult(null)
    fetch(`/api/route/day?date=${date}&memberId=${memberId}`)
      .then(r => (r.ok ? r.json() : { stops: [] }))
      .then((d: { stops?: Stop[] }) => {
        if (cancelled) return
        const ss = d.stops ?? []
        setStops(ss)
        setSelected(new Set(ss.filter(s => s.blocked == null).map(s => s.id)))
      })
      .finally(() => { if (!cancelled) setLoadingDay(false) })
    return () => { cancelled = true }
  }, [date, memberId, hasBase])

  function shiftDay(delta: number) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    // Build YYYY-MM-DD from LOCAL parts — toISOString() would shift to UTC and
    // (in +12 NZ) land a day off, so "next" looked like a no-op.
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    setDate(`${y}-${m}-${day}`)
  }

  async function optimise() {
    setError(null)
    if (!base) { setError('Set your base first.'); return }
    // Send in booked-time order; the API keeps it when optimize=false.
    const chosen = stops
      .filter(s => s.blocked == null && selected.has(s.id))
      .slice()
      .sort((a, b) => (a.timeMins ?? 0) - (b.timeMins ?? 0))
    if (chosen.length === 0) { setError('Select at least one stop with a location.'); return }
    setOptimising(true)
    try {
      const res = await fetch('/api/route/optimise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stops: chosen.map(s => ({
            kind: s.kind,
            id: s.kind === 'client' ? s.clientId : s.classRunId,
            // Echoed back, so the run-sheet can find the day stop again.
            stopId: s.id,
          })),
          optimize: orderMode === 'shortest',
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(typeof body.error === 'string' ? body.error : 'Optimise failed'); return }
      setResult(body)
    } catch {
      setError('Optimise failed')
    } finally {
      setOptimising(false)
    }
  }

  const routable = stops.filter(s => s.blocked == null)
  const skipped = stops.filter(s => s.blocked != null)
  const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`)
  const fmtKm = (m: number) => `${(m / 1000).toFixed(1)} km`

  const navUrl = result && base
    ? `https://www.google.com/maps/dir/?api=1&origin=${base.lat},${base.lng}&destination=${base.lat},${base.lng}&waypoints=${result.stops
        .map(s => (s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : encodeURIComponent(s.address ?? '')))
        .filter(Boolean)
        .join('|')}&travelmode=driving`
    : null

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' })
  const initials = (name: string) => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  // The booked window for a stop, e.g. "9:30am – 10:15am".
  const windowOf = (s?: Stop | null) => (s?.time ? (s.endTime ? `${s.time} – ${s.endTime}` : s.time) : null)
  const byId = (stopId: string) => stops.find(s => s.id === stopId)
  const Avatar = ({ name }: { name: string }) => (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-50)] text-[11px] font-semibold text-[var(--pm-brand-700)] leading-none">
      {initials(name)}
    </span>
  )
  // What a stop is called on screen: the dogs on a 1:1 visit, the run's name
  // for a class or an event.
  const headline = (s: Stop) => (s.kind === 'client' && s.dogs?.length ? s.dogs.join(', ') : s.name)

  // ── No base of operations ────────────────────────────────────────────────
  //
  // A route is "leave from base, visit these, come back to base". With no base
  // there is no first leg, no last leg, and no distance for anything in
  // between — the column used to render anyway, with an Optimise button that
  // could only ever fail. Say what's missing and where to set it instead.
  if (!hasBase) {
    return (
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-start gap-3 px-4 py-4">
            <Home className="mt-0.5 h-[18px] w-[18px] shrink-0 text-slate-700" strokeWidth={1.75} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Set your base of operations first</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                Every route starts and ends somewhere — usually home or the yard. Until
                that address is set there&apos;s nothing to measure the day&apos;s driving
                from, so there&apos;s no order to put your stops in.
              </p>
            </div>
          </div>
          <div className="border-t border-slate-200 px-4 py-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Base address</p>
            <PlaceAutocomplete placeholder="Search your base address…" onSelect={saveBase} region={region} bias={null} />
            <p className="mt-2 text-[13px] text-slate-500">Saved as soon as you pick one — the day&apos;s route appears straight after.</p>
          </div>
          <Link
            href="/settings?tab=profile"
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
          >
            <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">Set it in Settings instead</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
          </Link>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4 h-[calc(100dvh-8rem)]">
      <div className="relative rounded-2xl overflow-hidden shadow-sm border border-slate-100 bg-slate-100 h-full min-h-[360px]">
        <div ref={mapHost} className="absolute inset-0" />
      </div>

      <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 pb-2">
        {/* Day switcher */}
        <div className="flex items-center justify-between rounded-2xl bg-white shadow-sm border border-slate-100 px-2 py-1.5">
          <button onClick={() => shiftDay(-1)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" title="Previous day"><ChevronLeft className="h-4 w-4" /></button>
          <label className="relative text-center cursor-pointer">
            <span className="block text-sm font-semibold text-slate-800">{dateLabel}</span>
            <span className="block text-[11px] text-[var(--pm-brand-600)] font-medium">Tap to change</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
          <button onClick={() => shiftDay(1)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" title="Next day"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {members.length > 1 && (
          <select value={memberId} onChange={e => setMemberId(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]">
            <option value="all">All trainers</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {loadingDay && <p className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Loading day…</p>}
        {error && <p className="text-sm text-red-500 px-1">{error}</p>}

        {/* Base */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-50)] text-[var(--pm-brand-700)]"><Home className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Base · start &amp; end</p>
              {base && !showBaseInput
                ? <p className="text-sm text-slate-800 truncate">{base.address ?? `${base.lat.toFixed(4)}, ${base.lng.toFixed(4)}`}</p>
                : <p className="text-sm text-slate-400">Not set</p>}
            </div>
            {base && !showBaseInput && (
              <button onClick={() => setShowBaseInput(true)} className="text-slate-400 hover:text-[var(--pm-brand-600)]" aria-label="Change base address"><Pencil className="h-4 w-4" /></button>
            )}
          </div>
          {showBaseInput && <div className="mt-2.5"><PlaceAutocomplete placeholder="Search your base address…" onSelect={saveBase} region={region} bias={base ? { lat: base.lat, lng: base.lng } : null} /></div>}
        </div>

        {/* Order mode */}
        <div className="flex rounded-2xl bg-slate-100 p-1 text-sm">
          {([['time', 'Time order'], ['shortest', 'Shortest drive']] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setOrderMode(m); setResult(null) }}
              className={`flex-1 rounded-xl py-1.5 font-medium transition-colors ${orderMode === m ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Optimise CTA */}
        <button
          onClick={optimise}
          disabled={optimising}
          className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--pm-brand-600)] text-white text-sm font-semibold px-4 h-12 shadow-sm hover:bg-[var(--pm-brand-700)] active:scale-[0.99] transition disabled:opacity-50"
        >
          {optimising ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
          {optimising ? 'Optimising…' : 'Optimise route'}
        </button>

        {/* Optimised run-sheet — timeline */}
        {result && (
          <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[var(--pm-brand-50)]">
              <span className="text-sm font-semibold text-[var(--pm-brand-700)]">{fmtDur(result.totalDurationSec)} · {fmtKm(result.totalDistanceMeters)}</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setResult(null)} className="text-xs font-medium text-[var(--pm-brand-700)] hover:underline">Edit stops</button>
                {navUrl && (
                  <a href={navUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--pm-brand-700)] hover:underline">
                    <Navigation className="h-3.5 w-3.5" /> Google Maps
                  </a>
                )}
              </div>
            </div>
            <ol className="p-3">
              <li className="flex items-center gap-3 pb-2 text-xs text-slate-400">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Home className="h-4 w-4" /></span>
                Leave base
              </li>
              {result.stops.map((s, i) => {
                const src = byId(s.stopId)
                return (
                  <li key={s.stopId} className="relative flex items-start gap-3">
                    <div className="absolute left-[18px] top-9 bottom-0 w-px bg-slate-100" />
                    <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-600)] text-xs font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1 border-b border-slate-50 last:border-0 pb-3">
                      <div className="flex h-9 items-center justify-between gap-2">
                        <span className="font-medium text-slate-800 truncate">
                          {src ? headline(src) : s.name}
                        </span>
                        {windowOf(src) && <span className="text-xs font-semibold text-slate-600 shrink-0">{windowOf(src)}</span>}
                      </div>
                      <p className="text-xs text-slate-400 truncate -mt-1">
                        <a href={src?.href ?? '#'} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--pm-brand-600)] hover:underline">
                          {src?.kindLabel ? `${src.kindLabel} · ` : ''}{s.name}
                        </a>
                      </p>
                      {s.address && <p className="text-[11px] text-slate-400 truncate">{s.address}</p>}
                      {s.legDurationSec != null && <p className="text-[11px] text-slate-400 mt-0.5">🚗 {fmtDur(s.legDurationSec)} drive</p>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        {/* Stops to include — hidden once optimised (the run-sheet shows them). */}
        {!result && routable.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Stops · {selected.size} of {routable.length}</p>
            <div className="flex flex-col gap-1 -mx-1">
              {routable.map(s => {
                const on = selected.has(s.id)
                return (
                  <div key={s.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 cursor-pointer transition ${on ? 'bg-[var(--pm-brand-50)]' : 'hover:bg-slate-50'}`} onClick={() => toggle(s.id)}>
                    <Avatar name={s.name} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{headline(s)}</p>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-slate-400 hover:text-[var(--pm-brand-600)] hover:underline">
                        {s.kindLabel} · {s.name}
                      </a>
                      {s.address && <p className="text-xs text-slate-400 truncate">{s.address}</p>}
                    </div>
                    {windowOf(s) && <span className="text-xs font-semibold text-slate-500 shrink-0">{windowOf(s)}</span>}
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-[var(--pm-brand-600)] bg-[var(--pm-brand-600)] text-white' : 'border-slate-300'}`}>
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Not on the route — every booking that day the planner can't drive to,
            with the reason and the way to fix it. Dropping these silently made
            a half-planned day look like a complete one. */}
        {skipped.length > 0 && (
          <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Not on the route · {skipped.length}</p>
            <div className="flex flex-col gap-1.5">
              {skipped.map(s => (
                <div key={s.id}>
                  {settingAddrFor === s.id ? (
                    <div className="rounded-xl bg-slate-50 p-2.5">
                      <p className="text-sm font-medium text-slate-700 mb-1.5">{s.name}</p>
                      <PlaceAutocomplete
                        placeholder={`${s.name}'s address…`}
                        onSelect={r => saveClientAddr(s.id, s.clientId!, r)}
                        region={region}
                        bias={base ? { lat: base.lat, lng: base.lng } : null}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl px-1 py-1">
                      {s.blocked === 'virtual'
                        ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Video className="h-4 w-4" strokeWidth={1.75} /></span>
                        : s.blocked === 'no-location'
                          ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><MapPinOff className="h-4 w-4" strokeWidth={1.75} /></span>
                          : <Avatar name={s.name} />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-700 truncate">{headline(s)}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {s.blocked === 'virtual' ? 'Online — nothing to drive to'
                            : s.blocked === 'no-location' ? `${s.kindLabel} · no venue set`
                            : 'No address on file'}
                          {windowOf(s) ? ` · ${windowOf(s)}` : ''}
                        </p>
                      </div>
                      {s.blocked === 'no-address' && s.clientId && (
                        <button onClick={() => setSettingAddrFor(s.id)} className="text-xs font-medium text-[var(--pm-brand-700)] bg-white border border-slate-200 rounded-lg px-2.5 py-1 hover:bg-slate-50 shrink-0">Set address</button>
                      )}
                      {s.blocked === 'no-location' && (
                        <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-[var(--pm-brand-700)] bg-white border border-slate-200 rounded-lg px-2.5 py-1 hover:bg-slate-50 shrink-0">Add venue</a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Open client" for a 1:1, "Open class"/"Open event" for a group booking. */
function openLabelFor(s?: Stop | null): string {
  if (!s) return 'Open'
  if (s.kind === 'client') return 'Open client'
  return `Open ${s.kindLabel.toLowerCase()}`
}
