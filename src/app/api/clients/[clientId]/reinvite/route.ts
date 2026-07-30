import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderClientInviteEmail, DEFAULT_INVITE_BODY } from '@/lib/client-invite-email'
import { ensureTrainerSlug, clientInviteUrl } from '@/lib/slug'
import { mergeClientDogs } from '@/lib/dogs'

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
  // Re-inviting sends sign-in credentials — manager-level (clients.invite).
  const guard = await guardPermission('clients.invite')
  if (guard instanceof NextResponse) return guard
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
      // `id` so a dog that is both primary and on the household list is named
      // once in the invite email.
      dog: { select: { id: true, name: true } },
      dogs: { select: { id: true, name: true } },
    },
  })
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // No address, nothing to send to. A client can legitimately have none — the
  // trainer knows them by phone — so this is an ordinary state to report, not
  // an error to log. 422 rather than 400: the request was well-formed, the
  // record just cannot satisfy it.
  const clientEmail = client.user.email
  if (!clientEmail) {
    return NextResponse.json(
      { error: 'This client has no email address, so there is nothing to send an invite to. Add one to their profile first.' },
      { status: 422 },
    )
  }

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
  await prisma.verificationToken.deleteMany({ where: { identifier: clientEmail } })

  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  await prisma.verificationToken.create({
    data: { identifier: clientEmail, token: inviteToken, expires },
  })

  const slug = await ensureTrainerSlug(trainerId)
  const inviteUrl = clientInviteUrl(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com', slug, inviteToken, clientEmail)

  const dogNames = mergeClientDogs(client.dog, client.dogs)
    .map(d => d.name)
    .filter((n): n is string => !!n)

  const rendered = renderClientInviteEmail({
    clientName: client.user.name ?? clientEmail,
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
      to: clientEmail,
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

  // Record the first time an invite actually went out (a client originally
  // "added" without notification gets stamped here). Only set when null so
  // re-inviting an already-invited client preserves the original timestamp.
  await prisma.clientProfile.updateMany({
    where: { id: clientId, invitedAt: null },
    data: { invitedAt: new Date() },
  })

  return NextResponse.json({ ok: true, sentTo: clientEmail })
}
