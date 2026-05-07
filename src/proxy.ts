import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { NextResponse } from 'next/server'
import { PREVIEW_COOKIE } from '@/lib/client-context'

const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = [
  '/login', '/register', '/forgot-password', '/verify-email', '/invite',
  '/api/auth',
  '/api/cron',   // Bearer-token authed inside the route handler
  '/form',       // public embed forms
  '/api/form',   // public form submission API
]

// Trainer-only route prefixes
const TRAINER_PATHS = [
  '/dashboard', '/clients', '/schedule', '/templates', '/library',
  '/progress', '/messages', '/ai-tools', '/settings', '/help',
  '/packages', '/products',
]

// Client-only route prefixes
const CLIENT_PATHS = ['/home', '/my-profile', '/my-messages', '/my-help', '/my-sessions', '/my-shop', '/notifications']

export default auth((req) => {
  const { pathname } = req.nextUrl
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

    // Admin: only allow /admin paths (plus public + api)
    if (role === 'ADMIN' && !pathname.startsWith('/admin') && !isPublic) {
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

  return NextResponse.next()
})

export const config = {
  // Skip auth/role checks for static assets and App Router metadata routes
  // (manifest.json, icon, apple-icon, sitemap, robots) — these are public by design.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon|apple-icon|logo.png|icons/|sitemap.xml|robots.txt|public/).*)'],
}
