import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/verify-email', '/invite', '/api/auth']

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

    // Admin routes
    if (pathname.startsWith('/admin') && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Client trying to access trainer routes
    if (pathname.startsWith('/trainer') && role === 'CLIENT') {
      return NextResponse.redirect(new URL('/my-diary', req.url))
    }

    // Redirect root to appropriate dashboard
    if (pathname === '/') {
      if (role === 'ADMIN') return NextResponse.redirect(new URL('/admin', req.url))
      if (role === 'CLIENT') return NextResponse.redirect(new URL('/my-diary', req.url))
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
}
