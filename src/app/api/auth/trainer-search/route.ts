import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'

// "Find your trainer" lookup, used by the dog-owner signup form and by
// /find-trainer. Matches on business name only and returns only what a business
// already publishes about itself (name, logo, public /c/<slug> handle) — never
// an email, phone, address or client count.
//
// It lives under /api/auth/ deliberately: proxy.ts treats that prefix as public,
// and this has to answer for someone who has no account yet. It is NOT a
// NextAuth route — the [...nextauth] catch-all sits beside it and static
// segments win.
//
// Guard rails, because it is unauthenticated:
//   • 2-character minimum, so it can't be walked as a full directory dump
//   • 8 results max
//   • rate limited per IP

const MIN_QUERY = 2
const MAX_RESULTS = 8

export async function GET(req: Request) {
  const limited = await enforceRateLimit({
    key: `trainer-search:${getClientIp(req)}`,
    limit: 60,
    windowMs: 10 * 60_000,
  })
  if (limited) return limited

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < MIN_QUERY) return NextResponse.json({ trainers: [] })

  const trainers = await prisma.trainerProfile.findMany({
    where: {
      businessName: { contains: q, mode: 'insensitive' },
      // A deactivated account can't answer a join request, so don't offer it.
      user: { deactivatedAt: null },
    },
    orderBy: { businessName: 'asc' },
    take: MAX_RESULTS,
    select: { id: true, businessName: true, logoUrl: true, slug: true },
  })

  return NextResponse.json({ trainers })
}
