import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderClientInviteEmail } from '@/lib/client-invite-email'
import { ensureTrainerSlug, clientInviteUrl } from '@/lib/slug'
import { findOrJoinClient } from '@/lib/client-upsert'

const schema = z.object({
  clientName: z.string().min(2),
  dogNames: z.array(z.string().min(1)).min(1),
  clientEmail: z.string().email(),
  sendInvite: z.boolean().default(true),
  emailBody: z.string().optional(),
})

export async function POST(req: Request) {
  const guard = await guardPermission('clients.invite')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // Surface the first field-level error so the form can show "Email isn't
    // valid" etc. instead of a generic "Invalid input". flatten() also keeps
    // the structured details available for callers that want them.
    const flat = parsed.error.flatten()
    const firstField = Object.entries(flat.fieldErrors)[0]
    const message = firstField?.[1]?.[0]
      ?? flat.formErrors[0]
      ?? 'Invalid input'
    return NextResponse.json({ error: message, details: flat }, { status: 400 })
  }

  const { clientName, dogNames, clientEmail, sendInvite, emailBody } = parsed.data

  // Resolve the business by company id (works for managers too, not just the
  // owner). Email branding uses the business profile.
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: guard.companyId },
    select: {
      id: true,
      businessName: true,
      logoUrl: true,
      emailAccentColor: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!trainerProfile) {
    return NextResponse.json({ error: 'Trainer profile not found' }, { status: 404 })
  }

  // A returning person (email already on file) is REUSED, and if they're
  // already this trainer's client we JOIN their existing profile — adding the
  // named dogs — rather than erroring. clientEmail is always a real address
  // here (required field), so it's always safe to dedupe on.
  const inviteToken = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await prisma.$transaction(async (tx) => {
    await findOrJoinClient(tx, {
      email: clientEmail,
      trainerId: trainerProfile.id,
      name: clientName,
      dogs: dogNames.map(name => ({ name })),
      // Stamp invitedAt only when the trainer is actually sending the invite
      // email (new profiles only). "Add client" (sendInvite off) leaves it null
      // so the "Invite your first client" onboarding step stays pending.
      invitedAt: sendInvite ? new Date() : null,
    })

    // Store invite token for magic-link style onboarding.
    await tx.verificationToken.create({
      data: {
        identifier: clientEmail,
        token: inviteToken,
        expires,
      },
    })
  })

  // Onboarding drip anchor: stamp the trainer's FIRST sent invite so the
  // invite-chase emails (24h / 72h after_first_invite_sent) can fire. Matches
  // the invitedAt semantics above (only when actually sending). updateMany +
  // null guard makes it idempotent and a no-op if there's no progress row yet.
  if (sendInvite) {
    await prisma.trainerOnboardingProgress
      .updateMany({
        where: { trainerId: trainerProfile.id, firstInviteSentAt: null },
        data: { firstInviteSentAt: new Date() },
      })
      .catch(err => console.error('[invite] firstInviteSentAt stamp failed:', err))
  }

  let emailError: string | null = null

  if (sendInvite && emailBody) {
    const slug = await ensureTrainerSlug(trainerProfile.id)
    const inviteUrl = clientInviteUrl(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com', slug, inviteToken, clientEmail)

    // Shared renderer — same branded shell as the re-invite nudge (white card,
    // accent strip, logo/initial avatar, app-store badges, "Sent with
    // PupManager" footer) so both emails stay byte-identical and we iterate in
    // one place.
    const rendered = renderClientInviteEmail({
      clientName,
      dogNames,
      trainer: {
        businessName: trainerProfile.businessName,
        logoUrl: trainerProfile.logoUrl,
        emailAccentColor: trainerProfile.emailAccentColor,
        user: { name: trainerProfile.user.name, email: trainerProfile.user.email },
      },
      bodyTemplate: emailBody,
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
        console.error('[invite] Resend error:', result.error)
        emailError = result.error.message
      }
    } catch (err) {
      console.error('[invite] Failed to send email:', err)
      emailError = err instanceof Error ? err.message : 'Unknown error'
    }
  }

  return NextResponse.json(
    { ok: true, ...(emailError ? { emailError } : {}) },
    { status: 201 }
  )
}
