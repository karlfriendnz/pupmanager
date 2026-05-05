import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DevicePlatform } from '@prisma/client'

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => null) as { token?: string; platform?: string } | null
  const token = body?.token?.trim()
  const platform = body?.platform

  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  if (platform !== 'IOS' && platform !== 'ANDROID') {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 })
  }

  // A device's APNs token can change owner (e.g. user signs out and another
  // signs in on the same device) — upserting on the unique token rebinds it.
  await prisma.deviceToken.upsert({
    where: { token },
    create: { token, platform: platform as DevicePlatform, userId: session.user.id },
    update: { userId: session.user.id, lastSeenAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
