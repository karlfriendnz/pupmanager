// Loads the Google Maps JS API once and caches the promise. Loads the libraries
// we need directly (places for autocomplete, geometry for decodePath, marker),
// so callers can use `google.maps.*` straight away — no importLibrary.
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY

let cached: Promise<typeof google> | null = null

export function loadMaps(): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.google?.maps) return Promise.resolve(window.google)
  if (cached) return cached
  cached = new Promise((resolve, reject) => {
    const existing = document.getElementById('gmaps-js') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google!))
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.id = 'gmaps-js'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&v=weekly&libraries=places,geometry,marker`
    s.async = true
    s.onload = () => resolve(window.google!)
    s.onerror = reject
    document.head.appendChild(s)
  })
  return cached
}
