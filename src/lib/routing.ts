// Route optimisation via Google Routes API (computeRoutes). We let Google solve
// the stop ordering (the Travelling Salesman part) with optimizeWaypointOrder —
// we never roll our own solver. One call optimises up to ~25 intermediate stops.
//
// Needs GOOGLE_MAPS_SERVER_KEY (a server-side, IP/secret-restricted key with the
// Routes API enabled). Keep it server-only — never ship it to the browser.

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'

export type LatLng = { lat: number; lng: number }

// A stop is either a geocoded point (a client's address) or a line of free
// text (a class venue — "the field behind the hall"). Venues have no
// coordinates anywhere in the schema and never have, so rather than bolt a
// geocoder on, we hand the text to the Routes API, which resolves it as part
// of the same call and tells us where it landed (see `legs.endLocation`).
export type Waypoint = LatLng | { address: string }

export type OptimisedRoute = {
  // Indices into the input `stops`, in the optimal visit order.
  order: number[]
  // Per-leg drive times/distances, in visit order (base→stop1, stop1→stop2, …, →base).
  // `end` is where the leg finished — the resolved position of that stop, which
  // is the only way an address-only stop gets onto the map.
  legs: { durationSec: number; distanceMeters: number; end: LatLng | null }[]
  totalDurationSec: number
  totalDistanceMeters: number
  // Encoded polyline for drawing the route on a map.
  polyline: string | null
}

function toWaypoint(p: Waypoint) {
  return 'address' in p
    ? { address: p.address }
    : { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
}

// Routes API points come back as { latitude, longitude } inside a location.
function toLatLng(loc: unknown): LatLng | null {
  const ll = (loc as { latLng?: { latitude?: number; longitude?: number } } | undefined)?.latLng
  if (!ll || typeof ll.latitude !== 'number' || typeof ll.longitude !== 'number') return null
  return { lat: ll.latitude, lng: ll.longitude }
}

// Driving distance + time for a single origin→destination (e.g. base → a client).
// Returns null on any failure so callers can degrade gracefully.
export async function routeDistance(
  origin: LatLng,
  destination: LatLng,
): Promise<{ distanceMeters: number; durationSec: number } | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) return null
  try {
    const res = await fetch(ROUTES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
    })
    if (!res.ok) return null
    const route = (await res.json())?.routes?.[0]
    if (!route) return null
    return { distanceMeters: route.distanceMeters ?? 0, durationSec: secs(route.duration) }
  } catch {
    return null
  }
}

function secs(d: unknown): number {
  // Routes API durations are strings like "1234s".
  if (typeof d === 'string') return parseInt(d.replace('s', ''), 10) || 0
  return 0
}

// Optimise the order of `stops` between a fixed origin and destination (usually
// the trainer's base for both — "leave from and return to base").
export async function optimiseRoute(
  origin: LatLng,
  destination: LatLng,
  stops: Waypoint[],
  // optimize=true → Google reorders for shortest drive (TSP). false → keep the
  // given order (e.g. booked-time order) and just compute the drive through it.
  optimize = true,
): Promise<OptimisedRoute> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set')
  if (stops.length === 0) throw new Error('No stops to route')
  if (stops.length > 25) throw new Error('Too many stops (max 25 per optimisation)')

  const body = {
    origin: toWaypoint(origin),
    destination: toWaypoint(destination),
    intermediates: stops.map(toWaypoint),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    optimizeWaypointOrder: optimize,
  }

  const res = await fetch(ROUTES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Ask only for the fields we use — Routes API bills/returns by field mask.
      'X-Goog-FieldMask': [
        'routes.optimizedIntermediateWaypointIndex',
        'routes.duration',
        'routes.distanceMeters',
        'routes.legs.duration',
        'routes.legs.distanceMeters',
        // Where each leg finished — how an address-only stop (a class venue)
        // gets coordinates to draw a marker at.
        'routes.legs.endLocation',
        'routes.polyline.encodedPolyline',
      ].join(','),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Routes API ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const route = data?.routes?.[0]
  if (!route) throw new Error('Routes API returned no route')

  return {
    order: Array.isArray(route.optimizedIntermediateWaypointIndex)
      ? route.optimizedIntermediateWaypointIndex
      : stops.map((_, i) => i),
    legs: Array.isArray(route.legs)
      ? route.legs.map((l: { duration?: string; distanceMeters?: number; endLocation?: unknown }) => ({
          durationSec: secs(l.duration),
          distanceMeters: l.distanceMeters ?? 0,
          end: toLatLng(l.endLocation),
        }))
      : [],
    totalDurationSec: secs(route.duration),
    totalDistanceMeters: route.distanceMeters ?? 0,
    polyline: route.polyline?.encodedPolyline ?? null,
  }
}
