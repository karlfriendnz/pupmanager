// Route optimisation via Google Routes API (computeRoutes). We let Google solve
// the stop ordering (the Travelling Salesman part) with optimizeWaypointOrder —
// we never roll our own solver. One call optimises up to ~25 intermediate stops.
//
// Needs GOOGLE_MAPS_SERVER_KEY (a server-side, IP/secret-restricted key with the
// Routes API enabled). Keep it server-only — never ship it to the browser.

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'

export type LatLng = { lat: number; lng: number }

export type OptimisedRoute = {
  // Indices into the input `stops`, in the optimal visit order.
  order: number[]
  // Per-leg drive times/distances, in visit order (base→stop1, stop1→stop2, …, →base).
  legs: { durationSec: number; distanceMeters: number }[]
  totalDurationSec: number
  totalDistanceMeters: number
  // Encoded polyline for drawing the route on a map.
  polyline: string | null
}

function toWaypoint(p: LatLng) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
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
  stops: LatLng[],
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
      ? route.legs.map((l: { duration?: string; distanceMeters?: number }) => ({
          durationSec: secs(l.duration),
          distanceMeters: l.distanceMeters ?? 0,
        }))
      : [],
    totalDurationSec: secs(route.duration),
    totalDistanceMeters: route.distanceMeters ?? 0,
    polyline: route.polyline?.encodedPolyline ?? null,
  }
}
