'use client'

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { loadMaps } from './maps-loader'

export type PlaceResult = { address: string; lat: number; lng: number; placeId: string }

// Address search built on the Places API (New) *Data* API
// (AutocompleteSuggestion) rather than the PlaceAutocompleteElement web
// component — that lets us use a normal controlled <input> we can pre-fill and
// edit. As the user types we fetch suggestions; picking one geocodes it and
// hands back coordinates (no separate geocoding call needed).
export function PlaceAutocomplete({
  onSelect,
  placeholder = 'Search address…',
  bias,
  initialValue = '',
}: {
  onSelect: (r: PlaceResult) => void
  placeholder?: string
  // Centre to bias results toward (the trainer's home city/base).
  bias?: { lat: number; lng: number } | null
  // Pre-fill the box with an existing address that the user can edit.
  initialValue?: string
}) {
  const [query, setQuery] = useState(initialValue)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenRef = useRef<any>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const blurRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => { clearTimeout(debounceRef.current); clearTimeout(blurRef.current) }, [])

  function onChange(value: string) {
    setQuery(value)
    clearTimeout(debounceRef.current)
    if (!value.trim()) { setSuggestions([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const google = await loadMaps()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const places: any = (google.maps as any).places
        if (!places?.AutocompleteSuggestion) return
        if (!tokenRef.current) tokenRef.current = new places.AutocompleteSessionToken()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const req: any = { input: value, sessionToken: tokenRef.current }
        if (bias) req.locationBias = { center: { lat: bias.lat, lng: bias.lng }, radius: 30000 }
        const { suggestions: result } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setSuggestions((result ?? []).filter((s: any) => s.placePrediction))
        setOpen(true)
      } catch {
        /* ignore — keep the typed text */
      }
    }, 250)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function pick(suggestion: any) {
    try {
      const place = suggestion.placePrediction.toPlace()
      await place.fetchFields({ fields: ['location', 'formattedAddress', 'id'] })
      const loc = place.location
      if (!loc) return
      const result: PlaceResult = {
        address: place.formattedAddress ?? '',
        lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
        lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
        placeId: place.id ?? '',
      }
      setQuery(result.address)
      setSuggestions([])
      setOpen(false)
      tokenRef.current = null // a session ends when a place is selected
      onSelect(result)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onFocus={() => { if (suggestions.length) setOpen(true) }}
          onBlur={() => { blurRef.current = setTimeout(() => setOpen(false), 150) }}
          className="w-full h-11 rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the input blur closes the list
                onMouseDown={e => { e.preventDefault(); pick(s) }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-[var(--pm-brand-50)]"
              >
                {s.placePrediction.text?.toString?.() ?? ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
