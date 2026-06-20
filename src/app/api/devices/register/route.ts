import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DevicePlatform } from '@/generated/prisma'

// APNs/FCM tokens are bounded strings — cap the length so the unique upsert key
// can't be abused with arbitrarily large input.
const registerSchema = z.object({
  token: z.string().trim().min(1).max(500),
  platform: z.enum(['IOS', 'ANDROID']),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = registerSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'A valid token and platform (IOS|ANDROID) are required' }, { status: 400 })
  const { token, platform } = parsed.data

  // A device's APNs token can change owner (e.g. user signs out and another
  // signs in on the same device) — upserting on the unique token rebinds it.
  await prisma.deviceToken.upsert({
    where: { token },
    create: { token, platform: platform as DevicePlatform, userId: session.user.id },
    update: { userId: session.user.id, lastSeenAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}

// Deregister a device token — called on sign-out so the user stops receiving
// pushes for an account they've logged out of. Deletes by the exact (unique)
// token, i.e. just this physical device.
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => null) as { token?: string } | null
  const token = body?.token?.trim()
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  await prisma.deviceToken.deleteMany({ where: { token } })
  return NextResponse.json({ ok: true })
}
