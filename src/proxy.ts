import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { NextResponse } from 'next/server'
import { PREVIEW_COOKIE } from '@/lib/client-context'

const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = [
  '/login', '/register', '/signup', '/forgot-password', '/reset-password', '/verify-email', '/verify-account', '/invite',
  '/api/auth',
  '/api/cron',   // Bearer-token authed inside the route handler
  '/api/webhooks', // Stripe + future inbound webhooks (signature-gated inside)
  '/form',       // public embed forms
  '/api/form',   // public form submission API
  '/c/',         // public per-trainer branded client login (/c/<slug>) — trailing slash so it can't match /clients

  '/concepts',   // TEMP: client-home redesign concept previews (mock data, no auth) — remove before ship
  '/concept-products', // TEMP: generated product images for the concept shop — remove before ship
  '/api/version', // build-id check for the stale-client reload guard (no secrets)
  // Universal Links / Android App Links discovery files. Apple and Google
  // fetch these on app install to verify domain↔app association; they
  // MUST resolve with no auth, no redirects, and Content-Type: application/json.
  '/.well-known/apple-app-site-association',
  '/.well-known/assetlinks.json',
]

// Trainer-only route prefixes
const TRAINER_PATHS = [
  '/dashboard', '/clients', '/schedule', '/templates', '/library',
  '/progress', '/messages', '/ai-tools', '/settings', '/help',
  '/packages', '/products',
]

// Client-only route prefixes
const CLIENT_PATHS = ['/home', '/my-profile', '/my-messages', '/my-help', '/my-sessions', '/my-shop', '/notifications', '/my-classes', '/my-dogs', '/my-achievements', '/my-availability', '/switch-trainer']

// The admin area lives under app.pupmanager.com/admin. `admin.pupmanager.com`
// is a convenience host that just redirects there — no separate deployment,
// no separate session. A deep link under /admin is preserved; anything else on
// the admin host lands on the dashboard.
const ADMIN_HOST = 'admin.pupmanager.com'
const CANONICAL_HOST = 'app.pupmanager.com'

export default auth((req) => {
  const { pathname, search } = req.nextUrl

  // Bounce the admin convenience subdomain to the canonical host first, before
  // any auth/role logic (works even when signed out — they then hit /login on
  // the canonical host as usual). Temporary redirect so we stay free to switch
  // to a real subdomain split later without a browser-cached 308 in the way.
  const host = (req.headers.get('host') ?? req.nextUrl.host).split(':')[0].toLowerCase()
  if (host === ADMIN_HOST) {
    const target = pathname.startsWith('/admin') ? pathname : '/admin'
    return NextResponse.redirect(`https://${CANONICAL_HOST}${target}${search}`)
  }

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  if (!req.auth && !isPublic) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (req.auth) {
    const role = req.auth.user?.role

    // Root redirect by role
    if (pathname === '/') {
      if (role === 'ADMIN') return NextResponse.redirect(new URL('/admin', req.url))
      if (role === 'CLIENT') return NextResponse.redirect(new URL('/home', req.url))
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Admin: only allow /admin paths (plus public + api). `/api/*` is the
    // backing surface for the admin UI (e.g. /api/admin/trainers, the new
    // /api/admin/demo/* seed routes), so we let it through here — the
    // routes themselves enforce role with requireAdmin().
    if (role === 'ADMIN' && !pathname.startsWith('/admin') && !pathname.startsWith('/api') && !isPublic) {
      return NextResponse.redirect(new URL('/admin', req.url))
    }

    // Non-admin trying to access /admin
    if (pathname.startsWith('/admin') && role !== 'ADMIN') {
      if (role === 'CLIENT') return NextResponse.redirect(new URL('/home', req.url))
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Client trying to access trainer paths
    if (role === 'CLIENT' && TRAINER_PATHS.some(p => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/home', req.url))
    }

    // Trainer trying to access client paths — allowed when in active client
    // preview mode (cookie set by /preview-as/[clientId]). Otherwise bounced
    // back to the trainer dashboard.
    if (role === 'TRAINER' && CLIENT_PATHS.some(p => pathname.startsWith(p))) {
      const previewing = req.cookies.get(PREVIEW_COOKIE)?.value
      if (!previewing) {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
    }
  }

  // Expose the current path to server components (the trainer layout reads
  // this to gate access without re-deriving the route). Set on the request
  // headers so it's available via `headers()` in RSC.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
})

export const config = {
  // Skip auth/role checks for static assets and App Router metadata routes
  // (manifest.json, icon, apple-icon, sitemap, robots) — these are public by design.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon|apple-icon|logo.png|logo-wordmark.png|email-logo.png|hero-illustration.png|app-store-badge.png|google-play-badge.png|founders-v2.png|icons/|sitemap.xml|robots.txt|public/).*)'],
}
