import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderClientInviteEmail, DEFAULT_INVITE_BODY } from '@/lib/client-invite-email'

// Re-send the invite/sign-in link email. Generates a fresh
// verificationToken (invalidating any older tokens we'd issued for
// the same email) and ships the same branded email the original
// /api/clients/invite send uses, so the trainer can chase clients
// who let the first email get buried — or just nudge an active
// client back into the app whenever they like.
//
// Trainers asked for this to work for *already-activated* clients
// too ("resend as many times as I want"), so the previous
// emailVerified refusal is gone — the same fresh-token link works
// as a one-tap sign-in for verified accounts (the /invite page
// accepts any valid token and routes through NextAuth's magic-link
// flow on the other side).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { clientId } = await params

  const client = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId },
    include: {
      user: { select: { name: true, email: true, emailVerified: true } },
      dog: { select: { name: true } },
      dogs: { select: { name: true } },
    },
  })
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      inviteTemplate: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!trainer) return NextResponse.json({ error: 'Trainer profile not found' }, { status: 404 })

  // Replace any stale tokens for this email so the new link is the
  // only working one — an old token landing in the trainer's chase
  // text wouldn't surprise them with a stale "expired" page.
  await prisma.verificationToken.deleteMany({ where: { identifier: client.user.email } })

  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  await prisma.verificationToken.create({
    data: { identifier: client.user.email, token: inviteToken, expires },
  })

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${inviteToken}&email=${encodeURIComponent(client.user.email)}`

  const dogNames = [client.dog?.name, ...client.dogs.map(d => d.name)].filter((n): n is string => !!n)

  const rendered = renderClientInviteEmail({
    clientName: client.user.name ?? client.user.email,
    dogNames: dogNames.length > 0 ? dogNames : ['your dog'],
    trainer: {
      businessName: trainer.businessName,
      logoUrl: trainer.logoUrl,
      emailAccentColor: trainer.emailAccentColor,
      user: { name: trainer.user.name, email: trainer.user.email },
    },
    bodyTemplate: trainer.inviteTemplate?.trim() || DEFAULT_INVITE_BODY,
    inviteUrl,
  })

  try {
    const result = await sendEmail({
      to: client.user.email,
      subject: rendered.subject,
      from: fromTrainer(rendered.displayName),
      replyTo: rendered.trainerEmail ?? undefined,
      text: rendered.text,
      html: rendered.html,
    })
    if (result.error) {
      console.error('[reinvite] Resend error:', result.error)
      return NextResponse.json({ error: result.error.message }, { status: 502 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email send failed'
    console.error('[reinvite] Failed to send email:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ ok: true, sentTo: client.user.email })
}
