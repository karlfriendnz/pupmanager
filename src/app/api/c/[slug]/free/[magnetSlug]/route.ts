import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { sendEmail, fromTrainer } from '@/lib/email'
import { buildLeadMagnetEmail } from '@/lib/lead-magnet-email'
import { subscriberUnsubscribeUrl } from '@/lib/subscriber-unsubscribe-token'

// Public lead-magnet sign-up. Captures a Subscriber on the trainer's mailing
// list (with a consent snapshot) and emails them the download link. No account
// is created. Rate-limited + length-capped because it's unauthenticated.
const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  consent: z.boolean().refine((v) => v === true, { message: 'Please tick the consent box.' }),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; magnetSlug: string }> },
) {
  const limited = await enforceRateLimit({ key: `lead-magnet:${getClientIp(req)}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { slug, magnetSlug } = await params

  const trainer = await prisma.trainerProfile.findUnique({
    where: { slug },
    select: {
      id: true, businessName: true, logoUrl: true, emailAccentColor: true,
      user: { select: { name: true, email: true } },
      leadMagnets: { where: { slug: magnetSlug, isActive: true }, select: { id: true, title: true, fileUrl: true, consentText: true } },
    },
  })
  const magnet = trainer?.leadMagnets[0]
  if (!trainer || !magnet) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Public page goes dark if the trainer no longer has the add-on.
  if (!(await hasAddon(trainer.id, 'leadmagnets'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { name, email } = parsed.data
  const cleanEmail = email.trim().toLowerCase()

  // Upsert onto the mailing list — a repeat sign-up re-subscribes (fresh
  // consent) and refreshes the source magnet.
  const subscriber = await prisma.subscriber.upsert({
    where: { trainerId_email: { trainerId: trainer.id, email: cleanEmail } },
    create: {
      trainerId: trainer.id,
      email: cleanEmail,
      name: name.trim() || null,
      status: 'SUBSCRIBED',
      sourceLeadMagnetId: magnet.id,
      consentText: magnet.consentText,
      consentAt: new Date(),
    },
    update: {
      name: name.trim() || undefined,
      status: 'SUBSCRIBED',
      sourceLeadMagnetId: magnet.id,
      consentText: magnet.consentText,
      consentAt: new Date(),
      unsubscribedAt: null,
    },
    select: { id: true },
  })

  // Email the download link from the platform sender (always available — no
  // dependency on the trainer verifying their own domain), reply-to the trainer.
  const displayName = trainer.businessName || trainer.user.name || 'Your trainer'
  const { subject, html, text } = buildLeadMagnetEmail({
    subscriberName: name,
    trainer: {
      displayName,
      businessName: trainer.businessName || displayName,
      logoUrl: trainer.logoUrl,
      emailAccentColor: trainer.emailAccentColor,
    },
    magnetTitle: magnet.title,
    downloadUrl: magnet.fileUrl,
    unsubscribeUrl: subscriberUnsubscribeUrl(subscriber.id),
  })
  try {
    await sendEmail({
      to: cleanEmail,
      subject,
      html,
      text,
      from: fromTrainer(displayName),
      replyTo: trainer.user.email ?? undefined,
    })
  } catch (err) {
    // Don't lose the lead if delivery hiccups — they're captured; log it.
    console.error('[lead-magnet email]', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ ok: true })
}
