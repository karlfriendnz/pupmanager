'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Home, Navigation, MapPin, Loader2, Pencil, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { loadMaps } from '@/components/maps/maps-loader'
import { PlaceAutocomplete, type PlaceResult } from '@/components/maps/place-autocomplete'

type Client = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; time?: string | null; endTime?: string | null; timeMins?: number | null; dogs?: string[] }
type Base = { address: string | null; lat: number; lng: number } | null
type Member = { id: string; name: string }
type OptStop = {
  clientId: string; name: string; address: string | null; lat: number; lng: number
  legDurationSec: number | null; legDistanceMeters: number | null
}
type OptResult = { stops: OptStop[]; totalDurationSec: number; totalDistanceMeters: number; polyline: string | null }

const AUCKLAND = { lat: -36.8485, lng: 174.7633 }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
// Marker bubble: client name + link to their profile (new tab).
const bubble = (name: string, clientId: string, time?: string | null) =>
  `<div style="font:14px -apple-system,sans-serif;min-width:120px">
     <strong>${esc(name)}</strong>${time ? ` · ${esc(time)}` : ''}<br/>
     <a href="/clients/${esc(clientId)}/edit?tab=details" target="_blank" rel="noopener" style="color:#2563eb">Open client →</a>
   </div>`

export function RouteManager({
  base: initialBase,
  clients: initialClients,
  members,
  initialDate,
}: {
  base: Base
  clients: Client[]
  members: Member[]
  initialDate: string
}) {
  const searchParams = useSearchParams()
  const urlDate = searchParams.get('date')
  const validUrlDate = urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : null

  const [base, setBase] = useState<Base>(initialBase)
  const [clients, setClients] = useState<Client[]>(initialClients)
  // Date is driven by the URL (?date) so clicking a day in the schedule always
  // reflects here, regardless of server re-render/caching.
  const [date, setDate] = useState(validUrlDate ?? initialDate)
  const [memberId, setMemberId] = useState('all')
  // 'time' = keep booked-time order (default — you can't do the 4pm before the
  // 1pm); 'shortest' = let Google reorder for least driving (flexible days).
  const [orderMode, setOrderMode] = useState<'time' | 'shortest'>('time')
  const [loadingDay, setLoadingDay] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialClients.filter(c => c.lat != null).map(c => c.id)),
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

  // Init map once.
  useEffect(() => {
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Marker that opens a client bubble on click.
    const stopMarker = (
      opts: google.maps.MarkerOptions,
      content: { name: string; clientId: string; time?: string | null },
    ) => {
      const m = new google.maps.Marker(opts)
      m.addListener('click', () => { info.setContent(bubble(content.name, content.clientId, content.time)); info.open(map, m) })
      add(m)
      return m
    }

    if (base) {
      add(new google.maps.Marker({ position: base, map, label: { text: '🏠', fontSize: '16px' }, title: 'Base' }))
      bounds.extend(base)
    }

    if (result) {
      result.stops.forEach((s, i) => {
        stopMarker(
          { position: { lat: s.lat, lng: s.lng }, map, label: { text: String(i + 1), color: '#fff', fontWeight: '700' }, title: `${i + 1}. ${s.name}` },
          { name: s.name, clientId: s.clientId, time: clients.find(c => c.id === s.clientId)?.time },
        )
        bounds.extend({ lat: s.lat, lng: s.lng })
      })
      if (result.polyline) {
        const path = google.maps.geometry.encoding.decodePath(result.polyline)
        add(new google.maps.Polyline({ path, map, strokeColor: '#2a9da9', strokeWeight: 4, strokeOpacity: 0.85 }))
      }
    } else {
      clients.filter(c => c.lat != null && selected.has(c.id)).forEach(c => {
        stopMarker({ position: { lat: c.lat!, lng: c.lng! }, map, title: c.name }, { name: c.name, clientId: c.id, time: c.time })
        bounds.extend({ lat: c.lat!, lng: c.lng! })
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
  }, [base, clients, selected, result, mapReady])

  async function saveBase(r: PlaceResult) {
    setBase({ address: r.address, lat: r.lat, lng: r.lng })
    setShowBaseInput(false); setResult(null)
    await fetch('/api/route/base', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
  }
  async function saveClientAddr(clientId: string, r: PlaceResult) {
    setClients(cs => cs.map(c => (c.id === clientId ? { ...c, address: r.address, lat: r.lat, lng: r.lng } : c)))
    setSelected(s => new Set(s).add(clientId))
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
  useEffect(() => {
    let cancelled = false
    setLoadingDay(true); setResult(null)
    fetch(`/api/route/day?date=${date}&memberId=${memberId}`)
      .then(r => (r.ok ? r.json() : { clients: [] }))
      .then((d: { clients?: Client[] }) => {
        if (cancelled) return
        const cs = d.clients ?? []
        setClients(cs)
        setSelected(new Set(cs.filter(c => c.lat != null).map(c => c.id)))
      })
      .finally(() => { if (!cancelled) setLoadingDay(false) })
    return () => { cancelled = true }
  }, [date, memberId])

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
    if (!base) { setError('Set your base first.'); setShowBaseInput(true); return }
    // Send in booked-time order; the API keeps it when optimize=false.
    const ids = clients
      .filter(c => c.lat != null && selected.has(c.id))
      .slice()
      .sort((a, b) => (a.timeMins ?? 0) - (b.timeMins ?? 0))
      .map(c => c.id)
    if (ids.length === 0) { setError('Select at least one client with an address.'); return }
    setOptimising(true)
    try {
      const res = await fetch('/api/route/optimise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: ids, optimize: orderMode === 'shortest' }),
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

  const located = clients.filter(c => c.lat != null)
  const unlocated = clients.filter(c => c.lat == null)
  const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`)
  const fmtKm = (m: number) => `${(m / 1000).toFixed(1)} km`

  const navUrl = result && base
    ? `https://www.google.com/maps/dir/?api=1&origin=${base.lat},${base.lng}&destination=${base.lat},${base.lng}&waypoints=${result.stops.map(s => `${s.lat},${s.lng}`).join('|')}&travelmode=driving`
    : null

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' })
  const initials = (name: string) => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const dogsOf = (clientId: string) => clients.find(c => c.id === clientId)?.dogs ?? []
  // The booked session window for a stop, e.g. "9:30am – 10:15am".
  const windowOf = (c?: Client | null) => (c?.time ? (c.endTime ? `${c.time} – ${c.endTime}` : c.time) : null)
  const windowById = (clientId: string) => windowOf(clients.find(c => c.id === clientId))
  const Avatar = ({ name }: { name: string }) => (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-50)] text-[11px] font-semibold text-[var(--pm-brand-700)] leading-none">
      {initials(name)}
    </span>
  )


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
              <button onClick={() => setShowBaseInput(true)} className="text-slate-400 hover:text-[var(--pm-brand-600)]"><Pencil className="h-4 w-4" /></button>
            )}
          </div>
          {(!base || showBaseInput) && <div className="mt-2.5"><PlaceAutocomplete placeholder="Search your base address…" onSelect={saveBase} bias={base ? { lat: base.lat, lng: base.lng } : null} /></div>}
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
              {result.stops.map((s, i) => (
                <li key={s.clientId} className="relative flex items-start gap-3">
                  <div className="absolute left-[18px] top-9 bottom-0 w-px bg-slate-100" />
                  <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-600)] text-xs font-bold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1 border-b border-slate-50 last:border-0 pb-3">
                    <div className="flex h-9 items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 truncate">
                        {dogsOf(s.clientId).length ? dogsOf(s.clientId).join(', ') : s.name}
                      </span>
                      {windowById(s.clientId) && <span className="text-xs font-semibold text-slate-600 shrink-0">{windowById(s.clientId)}</span>}
                    </div>
                    <p className="text-xs text-slate-400 truncate -mt-1">
                      <a href={`/clients/${s.clientId}/edit?tab=details`} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--pm-brand-600)] hover:underline">{s.name}</a>
                    </p>
                    {s.address && <p className="text-[11px] text-slate-400 truncate">{s.address}</p>}
                    {s.legDurationSec != null && <p className="text-[11px] text-slate-400 mt-0.5">🚗 {fmtDur(s.legDurationSec)} drive</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Stops to include — hidden once optimised (the run-sheet shows them). */}
        {!result && located.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Stops · {selected.size} of {located.length}</p>
            <div className="flex flex-col gap-1 -mx-1">
              {located.map(c => {
                const on = selected.has(c.id)
                return (
                  <div key={c.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 cursor-pointer transition ${on ? 'bg-[var(--pm-brand-50)]' : 'hover:bg-slate-50'}`} onClick={() => toggle(c.id)}>
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{c.dogs?.length ? c.dogs.join(', ') : c.name}</p>
                      <a href={`/clients/${c.id}/edit?tab=details`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-slate-400 hover:text-[var(--pm-brand-600)] hover:underline">{c.name}</a>
                      {c.address && <p className="text-xs text-slate-400 truncate">{c.address}</p>}
                    </div>
                    {windowOf(c) && <span className="text-xs font-semibold text-slate-500 shrink-0">{windowOf(c)}</span>}
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-[var(--pm-brand-600)] bg-[var(--pm-brand-600)] text-white' : 'border-slate-300'}`}>
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* No address yet */}
        {unlocated.length > 0 && (
          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 mb-2">No address yet · {unlocated.length}</p>
            <div className="flex flex-col gap-1.5">
              {unlocated.map(c => (
                <div key={c.id}>
                  {settingAddrFor === c.id ? (
                    <div className="rounded-xl bg-white p-2.5">
                      <p className="text-sm font-medium text-slate-700 mb-1.5">{c.name}</p>
                      <PlaceAutocomplete placeholder={`${c.name}'s address…`} onSelect={r => saveClientAddr(c.id, r)} bias={base ? { lat: base.lat, lng: base.lng } : null} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl px-1 py-1">
                      <Avatar name={c.name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-700 truncate">{c.dogs?.length ? c.dogs.join(', ') : c.name}</p>
                        <a href={`/clients/${c.id}/edit?tab=details`} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-[var(--pm-brand-600)] hover:underline">{c.name}{windowOf(c) ? ` · ${windowOf(c)}` : ''}</a>
                      </div>
                      <button onClick={() => setSettingAddrFor(c.id)} className="text-xs font-medium text-[var(--pm-brand-700)] bg-white border border-amber-200 rounded-lg px-2.5 py-1 hover:bg-amber-50 shrink-0">Set address</button>
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
