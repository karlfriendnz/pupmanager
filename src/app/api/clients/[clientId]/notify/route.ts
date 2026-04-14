import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import crypto from 'crypto'
import { z } from 'zod'

const schema = z.object({
  subject: z.string().min(1).max(200),
  notes: z.string().max(2000).optional().nullable(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER')
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { subject, notes } = parsed.data

  // Get client's email and trainer's details
  const [clientUser, trainerProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: access.client.userId },
      select: { email: true, name: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: access.trainerId },
      select: { id: true, businessName: true },
    }),
  ])

  if (!clientUser?.email) {
    return NextResponse.json({ error: 'Client has no email address' }, { status: 400 })
  }
  if (!trainerProfile) {
    return NextResponse.json({ error: 'Trainer profile not found' }, { status: 404 })
  }

  // Generate a NextAuth-compatible magic link token.
  // NextAuth stores SHA256(token + AUTH_SECRET) in the DB; plain token goes in the URL.
  const plainToken = crypto.randomBytes(32).toString('hex')
  const secret = process.env.AUTH_SECRET ?? ''
  const hashedToken = crypto.createHash('sha256').update(`${plainToken}${secret}`).digest('hex')
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  // Remove any existing token for this email first (avoid duplicates)
  await prisma.verificationToken.deleteMany({ where: { identifier: clientUser.email } })

  // Store hashed token (NextAuth Resend callback format)
  await prisma.verificationToken.create({
    data: { identifier: clientUser.email, token: hashedToken, expires },
  })

  // Log the notification to the database
  await prisma.clientNotification.create({
    data: {
      clientId,
      trainerId: trainerProfile.id,
      subject,
      notes: notes ?? null,
    },
  })

  // Build magic link using the request's own host so it works in any environment
  const reqUrl = new URL(req.url)
  const appUrl = `${reqUrl.protocol}//${reqUrl.host}`
  const magicLink = `${appUrl}/api/auth/callback/resend?${new URLSearchParams({
    callbackUrl: '/my-profile',
    token: plainToken,
    email: clientUser.email,
  })}`

  const trainerName = trainerProfile.businessName ?? session.user.name ?? 'Your trainer'
  const clientName = clientUser.name ? `, ${clientUser.name}` : ''

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: clientUser.email,
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;">
          <p style="color:#64748b;font-size:13px;margin-bottom:16px;">From ${trainerName}</p>
          <h2 style="color:#0f172a;margin-bottom:16px;">Hi${clientName}!</h2>
          ${notes?.trim() ? `
          <div style="background:#f8fafc;border-left:3px solid #2563eb;padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:24px;">
            <p style="color:#334155;margin:0;white-space:pre-wrap;">${notes.trim()}</p>
          </div>
          ` : ''}
          <p style="color:#475569;margin-bottom:24px;">
            Click the button below to view your training diary — no password needed, the link logs you in automatically.
            This link expires in 24 hours.
          </p>
          <a href="${magicLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">
            View my training diary
          </a>
          <p style="color:#94a3b8;font-size:13px;margin-top:32px;">
            If you didn't expect this email, you can safely ignore it.
          </p>
        </div>
      `,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER')
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const notifications = await prisma.clientNotification.findMany({
    where: { clientId },
    orderBy: { sentAt: 'desc' },
    take: 50,
  })

  return NextResponse.json(notifications)
}
