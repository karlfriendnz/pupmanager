import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { renderTrainerEmail } from '@/lib/trainer-email-shell'
import { emailBodyToHtml } from '@/lib/email-html'
import { fillSystemEmail, systemEmailDef } from '@/lib/system-emails'

/**
 * The preview IS the email.
 *
 * It would be easy to rebuild the shell in React beside the editor, and the
 * two would drift the first time either changed — the trainer would be shown
 * one thing and their client would get another. So this renders the SAME
 * renderTrainerEmail the senders use, with the trainer's own logo and colour,
 * and hands back the HTML for an iframe.
 *
 * Sample values fill the {{tokens}} so it reads like a real send.
 */

const schema = z.object({
  key: z.string().min(1),
  subject: z.string().max(300),
  body: z.string().max(20000),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const tid = session.user.trainerId
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: tid },
    select: { businessName: true, logoUrl: true, emailAccentColor: true, user: { select: { name: true } } },
  })
  if (!trainer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const def = systemEmailDef(parsed.data.key)
  const business = trainer.businessName || 'Your business'
  const sample = {
    clientName: 'Aria',
    businessName: business,
    trainerName: trainer.user?.name || business,
    dogName: 'Bailey',
    code: '482913',
    amount: '£45.00',
    sessionDate: 'Saturday 8 August, 10:00 am',
    className: 'Gun Dog Level 3',
  }

  const html = renderTrainerEmail({
    trainer: {
      businessName: business,
      logoUrl: trainer.logoUrl,
      emailAccentColor: trainer.emailAccentColor,
    },
    title: fillSystemEmail(parsed.data.subject, sample) || def?.label || '',
    // The body is rich text from the editor; emailBodyToHtml is what the real
    // senders run it through, so the spacing here matches what lands.
    bodyHtml: emailBodyToHtml(fillSystemEmail(parsed.data.body, sample)),
    ctaLabel: `Open ${business}`,
    ctaUrl: '#',
  })

  return NextResponse.json({ html, from: `${business} via PupManager <noreply@pupmanager.com>`, subject: fillSystemEmail(parsed.data.subject, sample) })
}
