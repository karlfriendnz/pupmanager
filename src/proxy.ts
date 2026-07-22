import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { NextResponse } from 'next/server'
import { PREVIEW_COOKIE } from '@/lib/client-context'
import { PROFILE_COOKIE } from '@/lib/account-access'

const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = [
  '/login', '/register', '/signup', '/logout', '/forgot-password', '/reset-password', '/verify-email', '/verify-account', '/invite',
  '/api/auth',
  '/api/cron',   // Bearer-token authed inside the route handler
  '/api/webhooks', // Stripe + future inbound webhooks (signature-gated inside)
  '/form',       // public embed forms
  '/api/form',   // public form submission API
  '/unsubscribe', // public bulk-email unsubscribe (HMAC-token gated inside)
  '/c/',         // public per-trainer branded client login (/c/<slug>) — trailing slash so it can't match /clients
  '/l/',         // public per-trainer "link in bio" page (/l/<slug>) — trailing slash so it can't match /login/logout/library
  '/pay/',       // public no-login invoice pay page (/pay/<payToken>) — trailing slash
  '/api/pay/',   // public invoice checkout API (rate-limited, token-gated inside)
  '/sale/',      // guest instant-sale return page (/sale/thanks) — a guest has no
                 // account by definition, so Stripe can't return them anywhere gated

  '/concepts',   // TEMP: client-home redesign concept previews (mock data, no auth) — remove before ship
  '/concept-products', // TEMP: generated product images for the concept shop — remove before ship
  '/api/version', // build-id check for the stale-client reload guard (no secrets)
  '/api/app/',   // native-shell config (version-gate requirements) — read on launch pre-login, no secrets
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
  '/packages', '/products', '/notifications', '/instagram',
]

// Client-only route prefixes. The client feed is /my-notifications (matching the
// rest of the client's /my-* routes); the bare /notifications is the trainer feed.
const CLIENT_PATHS = ['/home', '/my-profile', '/my-messages', '/my-help', '/my-sessions', '/my-shop', '/my-notifications', '/my-dogs', '/my-achievements', '/my-availability', '/switch-trainer']

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
    // Which surface they're currently looking at. A person can hold both a
    // trainer relationship and a client one (own a business, contract for
    // another, be someone's client), and `role` only says where they LAND —
    // not what they may reach. The cookie records the side they switched to.
    //
    // Middleware can't hit the DB, so this is a routing hint only: the (trainer)
    // and (client) layouts re-derive real access from the database on every
    // request (lib/account-access), so a forged cookie gets you a redirect, not
    // access.
    const profileSide = req.cookies.get(PROFILE_COOKIE)?.value

    // Root redirect by role
    if (pathname === '/') {
      if (role === 'ADMIN') return NextResponse.redirect(new URL('/admin', req.url))
      // Honour a deliberate switch to the client side even for a TRAINER.
      if (profileSide === 'client') return NextResponse.redirect(new URL('/home', req.url))
      if (role === 'CLIENT' && profileSide !== 'trainer') {
        return NextResponse.redirect(new URL('/home', req.url))
      }
      // TRAINER: fall through to app/page.tsx, which honours the trainer's chosen
      // landing page (dashboard or schedule) — middleware can't read that pref.
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

    // Client on trainer paths — allowed when they've switched to their trainer
    // side (they contract for, or own, a business). The trainer layout verifies
    // that for real against the DB.
    if (role === 'CLIENT' && profileSide !== 'trainer' && TRAINER_PATHS.some(p => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/home', req.url))
    }

    // Trainer trying to access client paths — allowed when in active client
    // preview mode (cookie set by /preview-as/[clientId]). Otherwise bounced
    // back to the trainer dashboard.
    if (role === 'TRAINER' && CLIENT_PATHS.some(p => pathname.startsWith(p))) {
      const previewing = req.cookies.get(PREVIEW_COOKIE)?.value
      // …or when they've switched to their own client side (a trainer who is
      // also somebody else's client). Verified for real in the client layout.
      if (!previewing && profileSide !== 'client') {
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
  // Skip auth/role checks for static assets and App Router metadata routes.
  // Exclude by file EXTENSION (not by name) so any public image/asset is skipped
  // regardless of what it's called — no need to allowlist each new file here.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|map|txt|xml|json|woff2?|ttf|otf|mp4|webm|mp3|pdf)$).*)',
  ],
}
