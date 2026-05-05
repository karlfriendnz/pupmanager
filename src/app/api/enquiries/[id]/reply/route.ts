import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, fromTrainer } from '@/lib/email'
import { escapeHtml } from '@/lib/enquiries'

const schema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
})

// Send a reply to the enquirer. v1 is one-way: we send via Resend from the
// platform domain but with a "Trainer Name via PupManager" From and
// `Reply-To: trainer@theirbusiness.com` so any reply lands in the trainer's
// real inbox. v2 will swap this for OAuth'd Gmail/Microsoft sending.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const enquiry = await prisma.enquiry.findFirst({
    where: { id, trainerId },
    include: {
      trainer: {
        select: {
          businessName: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  })
  if (!enquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const displayName = enquiry.trainer.user.name?.trim() || enquiry.trainer.businessName
  const trainerEmail = enquiry.trainer.user.email

  // Convert plain-text body to HTML preserving paragraph + line breaks.
  const htmlBody = parsed.data.body
    .split(/\n{2,}/)
    .map(para => `<p style="margin:0 0 1em;">${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
    .join('')

  try {
    await sendEmail({
      to: enquiry.email,
      subject: parsed.data.subject,
      from: fromTrainer(displayName),
      replyTo: trainerEmail,
      text: parsed.data.body,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 16px;color:#0f172a;line-height:1.5;">${htmlBody}<hr style="margin-top:32px;border:none;border-top:1px solid #e2e8f0;" /><p style="color:#94a3b8;font-size:12px;margin-top:16px;">${escapeHtml(displayName)} — sent via PupManager. Reply directly to this email to reach them.</p></div>`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[enquiries reply]', msg)
    return NextResponse.json({ error: 'Email failed to send', detail: msg }, { status: 502 })
  }

  const message = await prisma.enquiryMessage.create({
    data: {
      enquiryId: id,
      direction: 'OUTBOUND',
      subject: parsed.data.subject,
      bodyText: parsed.data.body,
      sentByUserId: session.user.id,
    },
  })

  // Mark viewed if not already, so a "reply without explicit open" still
  // clears the dashboard badge.
  if (!enquiry.viewedAt) {
    await prisma.enquiry.update({ where: { id }, data: { viewedAt: new Date() } })
  }

  return NextResponse.json({ ok: true, message })
}
