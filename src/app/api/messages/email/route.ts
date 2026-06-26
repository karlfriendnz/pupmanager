import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { sendEmail, fromTrainer } from '@/lib/email'
import { htmlHasText } from '@/lib/email-html'
import { buildClientEmail } from '@/lib/client-email'

const schema = z.object({
  clientId: z.string().min(1),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50_000), // rich-text HTML
})

// Compose & send a one-off email to a client from the Messages composer, and
// log it as an outbound Message so it shows in the thread history. Sends via the
// platform domain with a "Trainer via PupManager" From and the trainer's email
// as Reply-To, mirroring the enquiry-reply flow.
export async function POST(req: Request) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  if (!htmlHasText(parsed.data.body)) return NextResponse.json({ error: 'Message body is empty' }, { status: 400 })

  const client = await prisma.clientProfile.findFirst({
    where: { id: parsed.data.clientId, trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
      trainer: {
        select: {
          businessName: true,
          logoUrl: true,
          emailAccentColor: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  })
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!client.user.email) return NextResponse.json({ error: 'This client has no email address on file' }, { status: 422 })

  const displayName = client.trainer.user.name?.trim() || client.trainer.businessName
  const trainerEmail = client.trainer.user.email
  const businessName = client.trainer.businessName

  // Transactional 1:1 send — no unsubscribeUrl, so no opt-out footer (exempt).
  const { subject, html, bodyHtml, text: textBody } = buildClientEmail({
    recipient: { name: client.user.name, dogName: client.dog?.name },
    trainer: {
      displayName,
      businessName,
      logoUrl: client.trainer.logoUrl,
      emailAccentColor: client.trainer.emailAccentColor,
    },
    subject: parsed.data.subject,
    body: parsed.data.body,
  })

  try {
    await sendEmail({
      to: client.user.email,
      subject,
      from: fromTrainer(displayName),
      replyTo: trainerEmail,
      text: textBody,
      html,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[messages email]', msg)
    return NextResponse.json({ error: 'Email failed to send', detail: msg }, { status: 502 })
  }

  // Log to the thread so the trainer (and client app) sees the outbound email.
  const message = await prisma.message.create({
    data: {
      clientId: parsed.data.clientId,
      senderId: session.user.id,
      channel: 'TRAINER_CLIENT',
      body: `📧 ${subject}\n\n${textBody}`,
      bodyHtml,
    },
    include: { sender: { select: { name: true, email: true } } },
  })

  return NextResponse.json(message, { status: 201 })
}
